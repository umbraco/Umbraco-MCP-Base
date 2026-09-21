/**
 * Token + KV State Storage
 *
 * Manages OAuth state parameters and Umbraco token storage in KV.
 * Depends only on types/env.ts — no auth handler or consent dependencies.
 */

import { normalizeBaseUrl, getTelemetryAdapter } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import { logAuth } from "./log.js";
import { AUTH_REFRESH_SPAN, HostedTelemetryAttributes } from "../telemetry/attributes.js";

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

// ============================================================================
// Token Refresh
// ============================================================================

/**
 * Why a refresh failed, normalised so callers don't have to parse OAuth error
 * strings themselves.
 *
 * Only `expired` is **definitive**: Umbraco has told us this refresh token will
 * never work again (`invalid_grant` — expired, revoked, or already redeemed),
 * so the only recovery is a fresh login. Every other reason is potentially
 * transient and must not be treated as "the session is over", or a single
 * network blip would strip a working session's toolset.
 */
export type RefreshFailureReason =
  /** Definitive `invalid_grant` — the refresh token is expired, revoked or already redeemed. */
  | "expired"
  /** The token endpoint rejected the client, not the token (bad client_id/secret, wrong grant). */
  | "misconfigured"
  /** The token endpoint answered, but with a 5xx or an unusable body. */
  | "server_error"
  /** The token endpoint could not be reached at all. */
  | "network";

/** A refresh that produced a new access token (and usually a rotated refresh token). */
export interface RefreshSuccess {
  ok: true;
  accessToken: string;
  /**
   * The rotated refresh token, when Umbraco issued one. Callers holding an
   * in-memory copy of the old token MUST adopt this — OpenIddict rejects a
   * redeemed refresh token on its next use.
   */
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * A refresh that did not produce a token. `message` is safe to log and to
 * surface to an MCP client: it carries no token material.
 */
export interface RefreshFailure {
  ok: false;
  reason: RefreshFailureReason;
  /** HTTP status from the token endpoint; absent when the request never completed. */
  status?: number;
  /** The OAuth 2.0 `error` code the token endpoint returned, when it returned one. */
  error?: string;
  /** Human-readable summary. Never contains a token. */
  message: string;
}

export type RefreshTokenResult = RefreshSuccess | RefreshFailure;

/**
 * Strips control characters so a value that ends up in a log line (or in a
 * problem body we hand back to the MCP client) can't forge one.
 */
function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, "?");
}

/** OAuth 2.0 error codes that mean "your client is wrong", not "your token is stale". */
const CLIENT_ERROR_CODES = new Set([
  "invalid_client",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_request",
  "invalid_scope",
]);

/** Every OAuth error code we recognise in a token-endpoint error response. */
const KNOWN_ERROR_CODES = ["invalid_grant", ...CLIENT_ERROR_CODES];

/**
 * Pulls the OAuth 2.0 `error` code out of a token-endpoint error body.
 *
 * Prefers the RFC 6749 JSON shape (`{ "error": "invalid_grant" }`), which is
 * what OpenIddict returns. Falls back to a whole-word scan for a known code so
 * a proxy that rewrites the body to text still classifies correctly. Returns
 * `undefined` rather than guessing — an unrecognised body must not be read as
 * a definitive `invalid_grant`.
 */
function parseOAuthErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
      // Bounded and sanitised: it reaches an unconditional log line and an
      // RFC 7807 body, so it must not be able to forge either.
      return sanitizeForLog(parsed.error).slice(0, 64);
    }
  } catch {
    // Not JSON — fall through to the text scan.
  }
  return KNOWN_ERROR_CODES.find((code) =>
    new RegExp(`\\b${code}\\b`).test(body)
  );
}

/** Maps a token-endpoint rejection onto a `RefreshFailureReason`. */
function classifyRefreshFailure(
  status: number,
  errorCode: string | undefined
): RefreshFailureReason {
  if (errorCode === "invalid_grant") return "expired";
  if (errorCode && CLIENT_ERROR_CODES.has(errorCode)) return "misconfigured";
  if (status >= 500) return "server_error";
  // A 4xx we can't attribute to the token: most likely the client registration.
  // Deliberately NOT `expired` — see the `RefreshFailureReason` doc comment.
  return "misconfigured";
}

/**
 * In-flight refreshes, keyed by KV token key.
 *
 * `createPerRequestServer` fires the version check and the current-user fetch
 * in parallel, so one expiry produces two simultaneous 401s and — without this
 * — two simultaneous POSTs replaying the same refresh token. OpenIddict happens
 * to tolerate near-simultaneous redemption, but both responses rotate the token
 * and both write the same KV key, orphaning one of them. Coalescing on the
 * token key means one POST, one rotation, one KV write, and both callers get
 * the same result.
 *
 * Module-scoped is correct here: the key is the per-session KV reference, so
 * two different users can never collide, and a Worker isolate is single-
 * threaded (entries are removed as soon as the refresh settles).
 */
const inFlightRefreshes = new Map<string, Promise<RefreshTokenResult>>();

/**
 * Refreshes an expired Umbraco token using the refresh token, stores the new
 * tokens in KV, and reports the outcome as a discriminated union so callers can
 * tell "the session is over" (`expired`) apart from "try again" (everything else).
 *
 * Concurrent calls for the same `tokenKey` share a single token-endpoint
 * round-trip — see `inFlightRefreshes`.
 *
 * Prefers the site context persisted with the original token entry
 * (captured at login from the per-tenant SiteConfig) so cloud-routed
 * Workers — which have no env-wide UMBRACO_OAUTH_CLIENT_ID — can refresh
 * with the correct per-tenant client_id. Falls back to env vars for the
 * single-site / non-cloud case.
 */
export function refreshUmbracoToken(
  env: HostedMcpEnv,
  tokenKey: string,
  refreshToken: string,
  site?: StoredSiteContext
): Promise<RefreshTokenResult> {
  const inFlight = inFlightRefreshes.get(tokenKey);
  if (inFlight) {
    logAuth(env, `refreshUmbracoToken joining in-flight refresh key=${tokenKey}`);
    return inFlight;
  }

  const pending = performRefresh(env, tokenKey, refreshToken, site).finally(() => {
    // Runs before any awaiter of `pending` resumes, so a caller that retries
    // after a failure always starts a fresh attempt rather than re-reading a
    // settled one.
    inFlightRefreshes.delete(tokenKey);
  });
  inFlightRefreshes.set(tokenKey, pending);
  return pending;
}

/**
 * Sentinel for a failure body we couldn't even read, so the diagnostic line
 * distinguishes "Umbraco returned an empty body" from "reading the body threw".
 */
const UNREADABLE_BODY = "<unreadable>";

/** One token-endpoint round-trip: the tokens it produced, or why it didn't. */
type TokenEndpointAttempt =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; failure: RefreshFailure };

async function performRefresh(
  env: HostedMcpEnv,
  tokenKey: string,
  refreshToken: string,
  site?: StoredSiteContext
): Promise<RefreshTokenResult> {
  /**
   * Reads the persisted entry, logging rather than swallowing a KV failure.
   * A silent `null` here is how a healthy session gets killed: we fall back to
   * the caller's (possibly already-redeemed) snapshot, Umbraco answers
   * `invalid_grant`, and that reads as a definitive `expired`.
   */
  const readStoredEntry = () =>
    getStoredUmbracoToken(env.OAUTH_KV, tokenKey).catch((error) => {
      logAuth(
        env,
        `refreshUmbracoToken KV READ FAILED key=${tokenKey} error=${sanitizeForLog(
          error instanceof Error ? error.message : "unknown error"
        )}`
      );
      return null;
    });

  // Re-read KV first and prefer what's persisted there over the caller's
  // snapshot. A client instance can outlive several refreshes, and whoever
  // rotated the token last wrote it here; replaying the caller's stale copy
  // is a guaranteed `invalid_grant` ("already been redeemed").
  const stored = await readStoredEntry();
  const persistedRefreshToken = stored?.tokens?.refresh_token;
  const effectiveRefreshToken = persistedRefreshToken ?? refreshToken;
  if (persistedRefreshToken && persistedRefreshToken !== refreshToken) {
    logAuth(
      env,
      `refreshUmbracoToken key=${tokenKey} using rotated refresh token from KV instead of the caller's snapshot`
    );
  }
  const effectiveSite = site ?? stored?.site;

  const baseUrl = effectiveSite?.baseUrl ?? env.UMBRACO_BASE_URL;
  const serverUrl = effectiveSite?.serverUrl ?? env.UMBRACO_SERVER_URL;
  const clientId = effectiveSite?.oauthClientId ?? env.UMBRACO_OAUTH_CLIENT_ID;
  const clientSecret = effectiveSite?.oauthClientSecret ?? env.UMBRACO_OAUTH_CLIENT_SECRET;

  const endpoints = getBackofficeEndpoints(baseUrl, serverUrl);

  logAuth(
    env,
    `refreshUmbracoToken request key=${tokenKey} endpoint=${endpoints.token_endpoint} client_id=${clientId} has_client_secret=${!!clientSecret} site_context=${!!effectiveSite}`
  );

  // Traced because this is the path that breaks in production, and a refresh
  // appearing mid-request is also how a 401-then-retry shows up in a trace.
  //
  // The `logAuth` lines stay as they are: they carry the token key, the endpoint
  // and (on failure) part of the response body, which are exactly what you want
  // on `wrangler tail` while debugging and exactly what must not be exported to
  // a third-party backend. The span gets the status code and the normalised
  // failure reason, and nothing else identifying — no token key, no body.
  return getTelemetryAdapter().startSpan(
    AUTH_REFRESH_SPAN,
    { [HostedTelemetryAttributes.AUTH_SITE_CONTEXT]: !!effectiveSite },
    async (span): Promise<RefreshTokenResult> => {
      const fail = (failure: RefreshFailure): RefreshFailure => {
        span.setAttribute(HostedTelemetryAttributes.AUTH_OUTCOME, "failed");
        span.setAttribute(HostedTelemetryAttributes.AUTH_FAILURE_REASON, failure.reason);
        // Unconditional, unlike the `logAuth` diagnostics above: a refresh that
        // fails is the event an operator needs to see without having first set
        // LOG_AUTH. Status and error code only — no token key, no token, no body.
        console.warn(
          `[mcp-hosted] umbraco token refresh FAILED reason=${failure.reason} status=${failure.status ?? "n/a"} error=${failure.error ?? "n/a"}`
        );
        return failure;
      };

      /**
       * One POST of one refresh token, plus the classification of whatever came
       * back. Factored out so the `invalid_grant` retry below can spend a second
       * attempt on a newer token without duplicating the request or the
       * classification. Returns the failure rather than calling `fail()`, so a
       * rejection we're about to retry past doesn't warn or settle the span.
       */
      const postRefresh = async (tokenToPost: string): Promise<TokenEndpointAttempt> => {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokenToPost,
          client_id: clientId,
        });

        if (clientSecret) {
          params.set("client_secret", clientSecret);
        }

        let resp: Response;
        try {
          resp = await fetch(endpoints.token_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          });
        } catch (error) {
          const detail = sanitizeForLog(
            error instanceof Error ? error.message : "unknown error"
          );
          logAuth(env, `refreshUmbracoToken NETWORK FAILURE key=${tokenKey} error=${detail}`);
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "network",
              message: `Could not reach the Umbraco token endpoint: ${detail}`,
            },
          };
        }

        span.setAttribute(HostedTelemetryAttributes.HTTP_STATUS, resp.status);

        if (!resp.ok) {
          const body = await resp.text().catch(() => UNREADABLE_BODY);
          logAuth(
            env,
            `refreshUmbracoToken FAILED key=${tokenKey} status=${resp.status} body=${body.slice(0, 500)}`
          );
          const errorCode = parseOAuthErrorCode(body);
          const reason = classifyRefreshFailure(resp.status, errorCode);
          return {
            ok: false,
            failure: {
              ok: false,
              reason,
              status: resp.status,
              error: errorCode,
              message:
                reason === "expired"
                  ? "Umbraco rejected the stored refresh token (invalid_grant): it has expired, been revoked, or already been redeemed."
                  : `Umbraco's token endpoint rejected the refresh request with HTTP ${resp.status}${errorCode ? ` (${errorCode})` : ""}.`,
            },
          };
        }

        let tokens: TokenResponse;
        try {
          tokens = (await resp.json()) as TokenResponse;
        } catch {
          logAuth(env, `refreshUmbracoToken UNPARSEABLE BODY key=${tokenKey} status=${resp.status}`);
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "server_error",
              status: resp.status,
              message: "Umbraco's token endpoint returned a success status with an unreadable body.",
            },
          };
        }

        if (typeof tokens?.access_token !== "string" || tokens.access_token.length === 0) {
          logAuth(env, `refreshUmbracoToken NO ACCESS TOKEN key=${tokenKey} status=${resp.status}`);
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "server_error",
              status: resp.status,
              message: "Umbraco's token endpoint returned a success status but no access token.",
            },
          };
        }

        return { ok: true, tokens };
      };

      let attempt = await postRefresh(effectiveRefreshToken);

      if (!attempt.ok && attempt.failure.reason === "expired") {
        // `invalid_grant` is only definitive for the token we actually posted.
        // A concurrent refresh — or one whose KV write hadn't landed when we
        // read above — rotates the token underneath us, and Umbraco then
        // correctly says "already redeemed" for the copy we still held. Re-read
        // KV once and, only if it now holds something we haven't tried, spend
        // exactly one more attempt on it. Bounded to a single retry: if that one
        // also fails, or KV holds the same token, the session really is over.
        const retryToken = (await readStoredEntry())?.tokens?.refresh_token;
        if (retryToken && retryToken !== effectiveRefreshToken) {
          logAuth(
            env,
            `refreshUmbracoToken RETRY key=${tokenKey} invalid_grant on the posted token; KV now holds a newer one, retrying once`
          );
          attempt = await postRefresh(retryToken);
        }
      }

      if (!attempt.ok) {
        return fail(attempt.failure);
      }

      const tokens = attempt.tokens;

      // Carry the site context forward so the next refresh round-trip also
      // uses the per-tenant client_id.
      //
      // Guarded: if this throws, Umbraco has already rotated the token and the
      // old one is spent, but nobody has persisted the new one. Rejecting here
      // would break the discriminated-union contract and leave the next attempt
      // replaying a redeemed token — i.e. a false `expired`. Report it as the
      // transient failure it is instead.
      try {
        await storeUmbracoToken(env.OAUTH_KV, tokenKey, tokens, effectiveSite, env);
      } catch (error) {
        const detail = sanitizeForLog(
          error instanceof Error ? error.message : "unknown error"
        );
        logAuth(env, `refreshUmbracoToken KV WRITE FAILED key=${tokenKey} error=${detail}`);
        return fail({
          ok: false,
          reason: "server_error",
          message: `Umbraco issued new tokens, but they could not be persisted: ${detail}`,
        });
      }

      logAuth(
        env,
        `refreshUmbracoToken OK key=${tokenKey} new_refresh=${!!tokens.refresh_token} expires_in=${tokens.expires_in ?? "n/a"}`
      );
      span.setAttribute(HostedTelemetryAttributes.AUTH_OUTCOME, "refreshed");
      span.setAttribute(
        HostedTelemetryAttributes.AUTH_ROTATED_REFRESH_TOKEN,
        !!tokens.refresh_token
      );
      return {
        ok: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      };
    }
  );
}
