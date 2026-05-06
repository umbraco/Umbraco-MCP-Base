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
 */
export function createSiteRoutingApiHandler(
  baseHandler: { fetch: FetchHandler },
  options: SiteRoutingApiHandlerOptions = {}
): { fetch: FetchHandler } {
  const externalPrefix = options.externalPrefix ?? "/at/";
  const internalPath = options.internalPath ?? "/mcp";
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname.startsWith(externalPrefix)) {
        url.pathname = internalPath;
        request = new Request(url.toString(), request);
      }
      return baseHandler.fetch(request, env, ctx);
    },
  };
}
