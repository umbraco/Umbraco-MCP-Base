/**
 * Token + KV State Storage
 *
 * Manages OAuth state parameters and Umbraco token storage in KV.
 * Depends only on types/env.ts — no auth handler or consent dependencies.
 */

import type { HostedMcpEnv } from "../types/env.js";

// ============================================================================
// Umbraco Backoffice Endpoint Paths
// ============================================================================

/** Well-known backoffice Management API security paths (Umbraco 14+) */
const BACKOFFICE_PATHS = {
  authorize: "/umbraco/management/api/v1/security/back-office/authorize",
  token: "/umbraco/management/api/v1/security/back-office/token",
  signout: "/umbraco/management/api/v1/security/back-office/signout",
} as const;

/**
 * Resolves the Umbraco backoffice OAuth endpoints from the base URL.
 *
 * Unlike the member/delivery API, the backoffice does not expose its own
 * OIDC discovery document. We construct URLs from well-known paths.
 *
 * @param baseUrl - Umbraco base URL (used for browser redirects like authorize)
 * @param serverBaseUrl - Optional override for server-side calls (token exchange).
 *   Useful in local dev when the Worker can't reach Umbraco over HTTPS
 *   (e.g. workerd rejects self-signed certs) and an HTTP proxy is used.
 */
export function getBackofficeEndpoints(baseUrl: string, serverBaseUrl?: string) {
  const browserBase = baseUrl.replace(/\/$/, "");
  const serverBase = serverBaseUrl ? serverBaseUrl.replace(/\/$/, "") : browserBase;
  return {
    authorization_endpoint: `${browserBase}${BACKOFFICE_PATHS.authorize}`,
    token_endpoint: `${serverBase}${BACKOFFICE_PATHS.token}`,
    signout_endpoint: `${browserBase}${BACKOFFICE_PATHS.signout}`,
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Token response from Umbraco's token endpoint.
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

// ============================================================================
// KV State Management
// ============================================================================

/**
 * Stores an OAuth state parameter in KV with expiry.
 * State is single-use and short-lived (10 minutes).
 */
export async function storeOAuthState(
  kv: KVNamespace,
  stateKey: string,
  data: Record<string, unknown>
): Promise<void> {
  await kv.put(`oauth_state:${stateKey}`, JSON.stringify(data), {
    expirationTtl: 600, // 10 minutes
  });
}

/**
 * Retrieves and deletes an OAuth state parameter from KV (single-use).
 */
export async function consumeOAuthState(
  kv: KVNamespace,
  stateKey: string
): Promise<Record<string, unknown> | null> {
  const key = `oauth_state:${stateKey}`;
  const data = await kv.get(key);
  if (!data) return null;

  // Delete immediately (single-use)
  await kv.delete(key);

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// ============================================================================
// Token Storage
// ============================================================================

/**
 * Stores Umbraco tokens in KV.
 *
 * Uses a long TTL (30 days) rather than matching the access token lifetime.
 * The access token expires naturally, but the refresh token inside the entry
 * allows the fetch client to transparently obtain a new one on 401 responses.
 * A short TTL would delete both access AND refresh tokens from KV, leaving
 * the MCP session permanently stuck with no way to recover.
 */
export async function storeUmbracoToken(
  kv: KVNamespace,
  tokenKey: string,
  tokens: TokenResponse
): Promise<void> {
  await kv.put(
    `umbraco_token:${tokenKey}`,
    JSON.stringify(tokens),
    { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
  );
}

/**
 * Retrieves a stored Umbraco token from KV.
 */
export async function getStoredUmbracoToken(
  kv: KVNamespace,
  tokenKey: string
): Promise<TokenResponse | null> {
  const data = await kv.get(`umbraco_token:${tokenKey}`);
  if (!data) return null;

  try {
    return JSON.parse(data) as TokenResponse;
  } catch {
    return null;
  }
}

// ============================================================================
// Logout Redirect Storage
// ============================================================================

/**
 * Stores the authorize URL for a reauth flow. After Umbraco's signout
 * endpoint clears the session cookie, the /logout-callback handler reads
 * this URL and redirects to it to start a fresh login.
 */
export async function storeLogoutRedirect(
  kv: KVNamespace,
  key: string,
  authorizeUrl: string
): Promise<void> {
  await kv.put(`logout_redirect:${key}`, authorizeUrl, {
    expirationTtl: 600, // 10 minutes
  });
}

/**
 * Reads and deletes a stored logout redirect URL (single-use).
 */
export async function consumeLogoutRedirect(
  kv: KVNamespace,
  key: string
): Promise<string | null> {
  const kvKey = `logout_redirect:${key}`;
  const url = await kv.get(kvKey);
  if (!url) return null;
  await kv.delete(kvKey);
  return url;
}

// ============================================================================
// Client Auth Markers
// ============================================================================

/**
 * Records that a client has completed at least one successful auth flow.
 * Used to decide whether to show the "Reauth" button on the consent screen.
 */
export async function markClientAuthed(
  kv: KVNamespace,
  clientId: string
): Promise<void> {
  await kv.put(`client_authed:${clientId}`, "1");
}

/**
 * Checks whether a client has previously completed an auth flow.
 */
export async function isClientAuthed(
  kv: KVNamespace,
  clientId: string
): Promise<boolean> {
  const val = await kv.get(`client_authed:${clientId}`);
  return val !== null;
}

/**
 * Refreshes an expired Umbraco token using the refresh token.
 * Stores the new tokens in KV and returns the new access token.
 */
export async function refreshUmbracoToken(
  env: HostedMcpEnv,
  tokenKey: string,
  refreshToken: string
): Promise<string | null> {
  const endpoints = getBackofficeEndpoints(env.UMBRACO_BASE_URL, env.UMBRACO_SERVER_URL);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.UMBRACO_OAUTH_CLIENT_ID,
  });

  if (env.UMBRACO_OAUTH_CLIENT_SECRET) {
    params.set("client_secret", env.UMBRACO_OAUTH_CLIENT_SECRET);
  }

  const resp = await fetch(endpoints.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!resp.ok) return null;

  const tokens = (await resp.json()) as TokenResponse;
  await storeUmbracoToken(env.OAUTH_KV, tokenKey, tokens);
  return tokens.access_token;
}
