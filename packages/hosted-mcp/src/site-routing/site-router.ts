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
import { buildPrefixRegex, extractSiteIdFromPath } from "./path-prefix.js";

export interface SiteRouterOptions {
  /**
   * Optional path the prefix should be rewritten to (e.g. "/mcp") before
   * delegating to `inner`.
   *
   * Leave undefined when the wrapped handler is OAuthProvider configured with
   * resource indicators — the OAuth access token's audience is bound to the
   * original `/<pathPrefix>/<siteId>` URL, so OAuthProvider must see that
   * URL to validate the token. In that case the consumer's `apiHandler`
   * does the internal rewrite to `/mcp` after token validation has succeeded.
   */
  rewriteTo?: string;
}

export type FetchHandler = (
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext
) => Promise<Response>;

export interface SiteRouterResult {
  /** A wrapped fetch handler that performs prefix rewriting. */
  fetch: FetchHandler;
  /** The compiled prefix regex, exported for reuse by other callers. */
  prefixRegex: RegExp;
  /**
   * Resolve a site for a given request. Returns:
   * - `{ ok: true, site }` when the request matches the prefix and resolveSite returns a SiteConfig
   * - `{ ok: false, status: 404 }` when the request matches the prefix but resolveSite returns null
   * - `null` when the request does not match the prefix at all
   *
   * Throws when resolveSite throws — callers may want to render a 502.
   */
  resolveForRequest: (
    request: Request,
    env: HostedMcpEnv
  ) => Promise<
    | { matched: true; site: SiteConfig }
    | { matched: true; site: null }
    | { matched: false }
  >;
}

/**
 * Create a site-router fetch wrapper from a SiteRoutingConfig.
 *
 * Usage:
 *
 * ```ts
 * const router = createSiteRouter(siteRouting, { rewriteTo: "/mcp" });
 * return router.fetch(request, env, ctx);
 * ```
 *
 * The returned `fetch` calls `inner` (the wrapped OAuthProvider or worker) for
 * non-matching requests. For matching requests it validates the site, rewrites
 * the path, and delegates.
 */
export function createSiteRouter(
  config: SiteRoutingConfig,
  options: SiteRouterOptions,
  inner: FetchHandler
): SiteRouterResult {
  const prefixRegex = buildPrefixRegex(config.pathPrefix);

  const resolveForRequest: SiteRouterResult["resolveForRequest"] = async (
    request,
    env
  ) => {
    const url = new URL(request.url);
    const siteId = extractSiteIdFromPath(url.pathname, prefixRegex);
    if (!siteId) return { matched: false };
    const site = await config.resolveSite(siteId, env);
    if (!site) return { matched: true, site: null };
    return { matched: true, site };
  };

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

  return { fetch, prefixRegex, resolveForRequest };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
