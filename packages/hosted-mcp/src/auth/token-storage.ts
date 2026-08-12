/**
 * Token + KV State Storage
 *
 * Manages OAuth state parameters and Umbraco token storage in KV.
 * Depends only on types/env.ts — no auth handler or consent dependencies.
 */

import { normalizeBaseUrl } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import { logAuth } from "./log.js";
import { buildFirewallHeader } from "../http/firewall-header.js";

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
  const browserBase = normalizeBaseUrl(baseUrl);
  const serverBase = serverBaseUrl ? normalizeBaseUrl(serverBaseUrl) : browserBase;
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

/**
 * Per-tenant OAuth context captured at login. Persisted alongside the tokens
 * so refresh can use the correct client_id / base URL even from call sites
 * that don't have the site resolved (e.g. chained-tools fetches), and on
 * cloud-routed Workers where the client_id is per-tenant rather than env-wide.
 */
export interface StoredSiteContext {
  oauthClientId: string;
  oauthClientSecret?: string;
  baseUrl: string;
  serverUrl?: string;
}

/**
 * The envelope written to KV. Backward-compatible read in
 * `getStoredUmbracoToken` falls back to treating raw TokenResponse JSON as
 * `{ tokens }` so pre-existing entries continue to work.
 */
interface StoredTokenEntry {
  tokens: TokenResponse;
  site?: StoredSiteContext;
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
  tokens: TokenResponse,
  site?: StoredSiteContext,
  env?: { LOG_AUTH?: string }
): Promise<void> {
  logAuth(
    env,
    `storeUmbracoToken key=${tokenKey} has_refresh=${!!tokens.refresh_token} expires_in=${tokens.expires_in ?? "n/a"} scope=${tokens.scope ?? "n/a"} has_site_context=${!!site} site_client_id=${site?.oauthClientId ?? "n/a"}`
  );
  const entry: StoredTokenEntry = site ? { tokens, site } : { tokens };
  await kv.put(
    `umbraco_token:${tokenKey}`,
    JSON.stringify(entry),
    { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
  );
}

/**
 * Retrieves a stored Umbraco token entry from KV.
 *
 * Reads both the current `{ tokens, site? }` envelope and the legacy
 * top-level TokenResponse format (so entries written before the envelope
 * landed still authenticate; they just won't have site context for refresh).
 */
export async function getStoredUmbracoToken(
  kv: KVNamespace,
  tokenKey: string
): Promise<StoredTokenEntry | null> {
  const data = await kv.get(`umbraco_token:${tokenKey}`);
  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "tokens" in parsed) {
      return parsed as unknown as StoredTokenEntry;
    }
    // Legacy: raw TokenResponse — wrap it.
    return { tokens: parsed as unknown as TokenResponse };
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
 *
 * Prefers the site context persisted with the original token entry
 * (captured at login from the per-tenant SiteConfig) so cloud-routed
 * Workers — which have no env-wide UMBRACO_OAUTH_CLIENT_ID — can refresh
 * with the correct per-tenant client_id. Falls back to env vars for the
 * single-site / non-cloud case.
 */
export async function refreshUmbracoToken(
  env: HostedMcpEnv,
  tokenKey: string,
  refreshToken: string,
  site?: StoredSiteContext
): Promise<string | null> {
  const baseUrl = site?.baseUrl ?? env.UMBRACO_BASE_URL;
  const serverUrl = site?.serverUrl ?? env.UMBRACO_SERVER_URL;
  const clientId = site?.oauthClientId ?? env.UMBRACO_OAUTH_CLIENT_ID;
  const clientSecret = site?.oauthClientSecret ?? env.UMBRACO_OAUTH_CLIENT_SECRET;

  const endpoints = getBackofficeEndpoints(baseUrl, serverUrl);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }

  logAuth(
    env,
    `refreshUmbracoToken request key=${tokenKey} endpoint=${endpoints.token_endpoint} client_id=${clientId} has_client_secret=${!!clientSecret} site_context=${!!site}`
  );

  const resp = await fetch(endpoints.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...buildFirewallHeader(env),
    },
    body: params.toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<unreadable>");
    logAuth(
      env,
      `refreshUmbracoToken FAILED key=${tokenKey} status=${resp.status} body=${body.slice(0, 500)}`
    );
    return null;
  }

  const tokens = (await resp.json()) as TokenResponse;
  logAuth(
    env,
    `refreshUmbracoToken OK key=${tokenKey} new_refresh=${!!tokens.refresh_token} expires_in=${tokens.expires_in ?? "n/a"}`
  );
  // Carry the site context forward so the next refresh round-trip also
  // uses the per-tenant client_id.
  await storeUmbracoToken(env.OAUTH_KV, tokenKey, tokens, site, env);
  return tokens.access_token;
}
