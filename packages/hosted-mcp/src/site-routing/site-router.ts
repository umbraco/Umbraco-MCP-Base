/**
 * Site router — handles URL-based site routing for hosted MCP servers.
 *
 * Wraps a fetch handler so that requests matching the configured `pathPrefix`
 * (e.g. `/at/{alias}/`) are validated via `resolveSite` and rewritten to the
 * single MCP endpoint path before being delegated to the wrapped handler.
 *
 * All other requests pass through unchanged.
 */

import type { HostedMcpEnv } from "../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../types/multi-site.js";
import type { AuthProps } from "../types/auth.js";
import { buildPrefixRegex, extractSiteIdFromPath } from "./path-prefix.js";
import { getStoredUmbracoToken } from "../auth/token-storage.js";
import { toBase64Url } from "../crypto/base64url.js";
import { resourceMetadataUrlFor } from "../server/resource-metadata.js";
import { hashWithKey, siteRef } from "../telemetry/request-telemetry.js";

export interface SiteRouterOptions {
  /**
   * Path the prefix should be rewritten to before delegating to `inner`
   * (e.g. "/mcp"). Leave undefined when `inner` is OAuthProvider configured
   * with resource indicators — its audience check needs to see the original
   * `/<pathPrefix>/<siteId>` URL.
   */
  rewriteTo?: string;
}

export type FetchHandler = (
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext
) => Promise<Response>;

export interface SiteRouterResult {
  /** Wrapped fetch handler that validates the site and (optionally) rewrites. */
  fetch: FetchHandler;
  /** Compiled prefix regex, exposed so the worker entry can probe it cheaply. */
  prefixRegex: RegExp;
}

/**
 * Wrap a fetch handler so requests matching `config.pathPrefix` are validated
 * via `config.resolveSite` (404 on null, 502 on throw) and either passed
 * through or rewritten to `options.rewriteTo`.
 */
export function createSiteRouter(
  config: SiteRoutingConfig,
  options: SiteRouterOptions,
  inner: FetchHandler
): SiteRouterResult {
  const prefixRegex = buildPrefixRegex(config.pathPrefix);

  const fetch: FetchHandler = async (request, env, ctx) => {
    const url = new URL(request.url);
    const siteId = extractSiteIdFromPath(url.pathname, prefixRegex);

    if (!siteId) {
      return inner(request, env, ctx);
    }

    let site: SiteConfig | null;
    try {
      site = await config.resolveSite(siteId, env);
    } catch (err) {
      console.error(`siteRouting.resolveSite threw for site=${await siteRef(siteId, env)}:`, err);
      return jsonResponse(
        { error: "Bad gateway", siteId, message: "Failed to resolve site" },
        502
      );
    }

    if (!site) {
      if (config.renderNotFound) {
        return config.renderNotFound(siteId, request);
      }
      return jsonResponse({ error: `Unknown site: ${siteId}` }, 404);
    }

    if (!options.rewriteTo) {
      return inner(request, env, ctx);
    }

    const rewrittenUrl = new URL(request.url);
    rewrittenUrl.pathname = options.rewriteTo;
    const rewrittenRequest = new Request(rewrittenUrl.toString(), request);
    return inner(rewrittenRequest, env, ctx);
  };

  return { fetch, prefixRegex };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface SiteRoutingApiHandlerOptions {
  /** External path prefix MCP clients connect via (e.g. "/at/"). */
  externalPrefix?: string;
  /** Internal path the wrapped McpAgent serves at (e.g. "/mcp"). */
  internalPath?: string;
}

/**
 * Wrap a `McpAgent.serve(path)` handler so site-routed URLs (`/at/<alias>/*`)
 * get rewritten to the McpAgent's internal path *after* OAuthProvider's
 * audience check has run on the original URL. Use as the OAuthProvider's
 * `apiHandler` when `apiRoute` includes the site-routing prefix.
 *
 * Binds each MCP session to the sign-in that started it: the session id the
 * client holds only works with that sign-in's access token (see "Session
 * binding" below), and any other request for the session gets `404 Session
 * not found`.
 *
 * Also checks, on every authenticated request, that the login's inner Umbraco
 * token entry still exists in KV. The outer grant (issued by OAuthProvider)
 * outlives Umbraco's refresh token, and the Durable Object deletes the inner
 * entry once Umbraco definitively rejects it. When it's gone, the outer grant
 * is revoked and the request gets a `401 invalid_token`, which MCP clients
 * answer by signing in again (#371). The Durable Object can't send that 401
 * itself (it is reached over a WebSocket upgrade), so it fails its start
 * instead (`UmbracoSignInUnavailableError`). When that start failed because
 * the entry was absent or was deleted (`expired`), this check returns the 401
 * once the entry reads as gone here. Other definitive rejections
 * (`misconfigured`, `request_rejected`) keep the entry, so this check passes
 * and the start keeps failing until an administrator fixes the client.
 */
export function createSiteRoutingApiHandler(
  baseHandler: { fetch: FetchHandler },
  options: SiteRoutingApiHandlerOptions = {}
): { fetch: FetchHandler } {
  const externalPrefix = options.externalPrefix ?? "/at/";
  const internalPath = options.internalPath ?? "/mcp";
  return {
    async fetch(request, env, ctx) {
      // Before the rewrite: the 401's `resource_metadata` must be built from
      // the URL OAuthProvider saw, exactly as on its own 401s.
      const expired = await rejectIfUmbracoSignInGone(request, env, ctx);
      if (expired) return expired;

      // An MCP session only accepts the sign-in that started it.
      const session = await openSessionForSignIn(request, ctx);
      if (session.rejected) return session.rejected;
      request = session.request;

      const url = new URL(request.url);
      if (url.pathname.startsWith(externalPrefix)) {
        url.pathname = internalPath;
        request = new Request(url.toString(), request);
      }
      return sealSessionForSignIn(await baseHandler.fetch(request, env, ctx), session.tokenKey);
    },
  };
}

// ============================================================================
// Session binding
// ============================================================================
//
// McpAgent finds a session's Durable Object by the `Mcp-Session-Id` header
// alone, and the session's MCP server is built once, for the sign-in that
// started it. Without a check here, any authenticated caller who learned
// another session's id (it is not a secret: it appears in traces and client
// logs) could send requests into that session and have them run as its user.
//
// So the id the client holds is `<session id>.<tag>`, where the tag is an
// HMAC of the session id keyed by the sign-in's token key. That key exists
// only inside the grant's encrypted props, so only requests carrying that
// sign-in's access token produce the same tag. The Durable Object still sees
// the bare session id. Nothing is stored, so there is no consistency window.

const SESSION_HEADER = "mcp-session-id";
const SESSION_TAG_SEPARATOR = ".";

async function sessionTag(tokenKey: string, sessionId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(tokenKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`mcp-session:${sessionId}`)
  );
  return toBase64Url(new Uint8Array(mac));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sessionNotFound(): Response {
  // 404 is what tells an MCP client to start a new session.
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Checks the request's session id against the caller's sign-in and swaps it
 * for the bare id the Durable Object knows. A request with no session id
 * (initialize) passes through. Without a token key in `ctx.props` there is
 * no sign-in to bind to, so the request passes through unchanged.
 */
async function openSessionForSignIn(
  request: Request,
  ctx: ExecutionContext
): Promise<{ request: Request; tokenKey?: string; rejected?: Response }> {
  const props = (ctx as { props?: unknown }).props as Partial<AuthProps> | undefined;
  const tokenKey = props?.umbracoTokenKey;
  if (typeof tokenKey !== "string" || tokenKey.length === 0) return { request };

  const presented = request.headers.get(SESSION_HEADER);
  if (presented === null) return { request, tokenKey };

  const split = presented.lastIndexOf(SESSION_TAG_SEPARATOR);
  const sessionId = split > 0 ? presented.slice(0, split) : "";
  const tag = split > 0 ? presented.slice(split + 1) : "";
  if (!sessionId || !tag || !constantTimeEqual(tag, await sessionTag(tokenKey, sessionId))) {
    return { request, tokenKey, rejected: sessionNotFound() };
  }

  const headers = new Headers(request.headers);
  headers.set(SESSION_HEADER, sessionId);
  return { request: new Request(request, { headers }), tokenKey };
}

/** Replaces the bare session id on a response with the one bound to this sign-in. */
async function sealSessionForSignIn(response: Response, tokenKey: string | undefined): Promise<Response> {
  const sessionId = response.headers.get(SESSION_HEADER);
  if (!tokenKey || !sessionId) return response;

  const headers = new Headers(response.headers);
  headers.set(
    SESSION_HEADER,
    `${sessionId}${SESSION_TAG_SEPARATOR}${await sessionTag(tokenKey, sessionId)}`
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Returns a `401 invalid_token` (after revoking the outer grant) when this
 * authenticated request's inner Umbraco token entry is missing from KV, or
 * `null` to let the request through.
 *
 * Fails open on anything that isn't a definite "entry is gone": no token key
 * in `ctx.props` (nothing to check) or a KV read that throws (an outage must
 * not sign every user out).
 */
async function rejectIfUmbracoSignInGone(
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext
): Promise<Response | null> {
  const props = (ctx as { props?: unknown }).props as Partial<AuthProps> | undefined;
  const tokenKey = props?.umbracoTokenKey;
  if (typeof tokenKey !== "string" || tokenKey.length === 0) return null;

  try {
    if (await getStoredUmbracoToken(env.OAUTH_KV, tokenKey)) return null;
  } catch (err) {
    console.error("[mcp-hosted] failed to read Umbraco token entry; letting the request through:", err);
    return null;
  }

  // OAuthProvider's access tokens are `{userId}:{grantId}:{secret}`. Parsed
  // defensively: whatever the header holds, the client still gets the 401.
  const grant = parseOuterAccessToken(request.headers.get("Authorization"));
  // Never the raw token key (it's the KV lookup key for that login's Umbraco
  // tokens) nor the bearer token: a keyed hash prefix when a hash key is set.
  console.warn(
    `[mcp-hosted] Umbraco sign-in gone; revoking outer grant and returning 401 login=${await loginRef(tokenKey, env)} grant_parsed=${grant !== null}`
  );
  if (grant) {
    try {
      await env.OAUTH_PROVIDER.revokeGrant(grant.grantId, grant.userId);
    } catch (err) {
      console.error("[mcp-hosted] failed to revoke outer grant for expired Umbraco sign-in:", err);
    }
  }

  const description = "Umbraco sign-in expired";
  return new Response(
    JSON.stringify({ error: "invalid_token", error_description: description }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${resourceMetadataUrlFor(request.url)}", error="invalid_token", error_description="${description}"`,
      },
    }
  );
}

/**
 * A log-safe reference to a login: the first 12 hex chars of the same keyed
 * hash `resolveRequestTelemetry` exports as `login_session`, or `<unhashed>`
 * when no hash key is configured (or hashing fails).
 */
async function loginRef(tokenKey: string, env: HostedMcpEnv): Promise<string> {
  const key = env.LOGIN_SESSION_HASH_KEY || env.TENANT_HASH_KEY;
  if (!key) return "<unhashed>";
  try {
    return (await hashWithKey(tokenKey, key)).slice(0, 12);
  } catch (err) {
    console.warn("[mcp-hosted] failed to hash login reference for logging:", err);
    return "<unhashed>";
  }
}

/** Splits an OAuthProvider bearer token into its user and grant ids, or `null`. */
function parseOuterAccessToken(
  authorization: string | null
): { userId: string; grantId: string } | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const parts = authorization.slice("Bearer ".length).split(":");
  if (parts.length !== 3) return null;
  const [userId, grantId, secret] = parts;
  if (!userId || !grantId || !secret) return null;
  return { userId, grantId };
}
