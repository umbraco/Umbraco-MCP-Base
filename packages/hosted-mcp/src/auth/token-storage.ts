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
 * Token is keyed by a unique reference and has a TTL matching the token expiry.
 */
export async function storeUmbracoToken(
  kv: KVNamespace,
  tokenKey: string,
  tokens: TokenResponse,
  expirationTtl?: number
): Promise<void> {
  const ttl = expirationTtl ?? tokens.expires_in ?? 3600;
  await kv.put(
    `umbraco_token:${tokenKey}`,
    JSON.stringify(tokens),
    { expirationTtl: ttl + 300 } // Add 5 minutes buffer for refresh
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
