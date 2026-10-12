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
import { resourceMetadataUrlFor } from "../server/resource-metadata.js";
import { hashWithKey } from "../telemetry/request-telemetry.js";

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
      console.error(`siteRouting.resolveSite threw for "${siteId}":`, err);
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
 * Also checks, on every authenticated request, that the login's inner Umbraco
 * token entry still exists in KV. The outer grant (issued by OAuthProvider)
 * outlives Umbraco's refresh token, and the Durable Object deletes the inner
 * entry once Umbraco definitively rejects it. When it's gone, the outer grant
 * is revoked and the request gets a `401 invalid_token`, which MCP clients
 * answer by signing in again — rather than being left on the degraded
 * one-tool `authentication-expired` server that no client ever calls (#371).
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

      const url = new URL(request.url);
      if (url.pathname.startsWith(externalPrefix)) {
        url.pathname = internalPath;
        request = new Request(url.toString(), request);
      }
      return baseHandler.fetch(request, env, ctx);
    },
  };
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
