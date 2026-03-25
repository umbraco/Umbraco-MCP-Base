/**
 * Worker Entry Point Helpers
 *
 * Provides the building blocks for creating a hosted Umbraco MCP Worker.
 *
 * The Worker entry point is defined in the consumer's worker.ts (built with wrangler)
 * because `agents/mcp` and `@cloudflare/workers-oauth-provider` are Wrangler virtual
 * modules that are only available at wrangler build time.
 *
 * This module provides:
 * - Type definitions for the Worker options
 * - The default handler (authorize, callback, landing page)
 * - Multi-site routing
 * - Helper to wire everything together
 */

import type {
  ToolCollectionExport,
  ToolModeDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import type { MultiSiteConfig } from "../types/multi-site.js";
import type { AuthProps, UmbracoAuthHandlerOptions } from "../types/auth.js";
import {
  createAuthorizeHandler,
  createCallbackHandler,
  createLogoutCallbackHandler,
} from "../auth/umbraco-handler.js";
import type { ConsentModeOption, ConsentToolConfig } from "../auth/consent.js";
import { type CreateServerOptions, type SiteResolver } from "./create-server.js";
import { loadWorkerConfig } from "../config/worker-config.js";

/**
 * Configuration for a chained MCP server's consent screen integration.
 * Provides the metadata needed to show chained server modes on the consent screen.
 */
export interface ChainedServerConsentConfig {
  /** Prefix used for tool names and mode values (e.g., "demo") */
  name: string;
  /** Display name shown as consent section header (e.g., "Demo Add-On") */
  displayName: string;
  /** Mode definitions from the chained server */
  modeRegistry: ToolModeDefinition[];
  /** Tool collections from the chained server */
  collections: ToolCollectionExport[];
  /** All valid mode names from the chained server */
  allModeNames: readonly string[];
  /** All valid slice names from the chained server */
  allSliceNames: readonly string[];
}

/**
 * Options for creating a hosted MCP server Worker.
 */
export interface HostedMcpServerOptions {
  /** Server name (displayed to MCP clients) */
  name: string;
  /** Server version */
  version: string;
  /** Tool collections to expose */
  collections: ToolCollectionExport[];
  /** Mode registry for tool filtering */
  modeRegistry: ToolModeDefinition[];
  /** All valid mode names */
  allModeNames: readonly string[];
  /** All valid slice names */
  allSliceNames: readonly string[];
  /** Optional factory to create the API client (see CreateServerOptions.clientFactory) */
  clientFactory?: () => unknown;
  /** Umbraco OAuth handler options */
  authOptions?: UmbracoAuthHandlerOptions;
  /** Enable tool selection on consent screen (auto-generates from mode registry) */
  enableConsentToolSelection?: boolean;
  /** Multi-site deployment configuration */
  multiSite?: MultiSiteConfig;
  /** Dynamic site resolver for URL-based site routing.
   *  See CreateServerOptions.resolveSite for details. */
  resolveSite?: SiteResolver;
  /** Chained MCP servers to include on consent screen and /info endpoint */
  chainedServers?: ChainedServerConsentConfig[];
}

/**
 * Extracts CreateServerOptions from HostedMcpServerOptions.
 * Used internally to pass to createPerRequestServer.
 */
export function getServerOptions(
  options: HostedMcpServerOptions
): CreateServerOptions {
  return {
    name: options.name,
    version: options.version,
    collections: options.collections,
    modeRegistry: options.modeRegistry,
    allModeNames: options.allModeNames,
    allSliceNames: options.allSliceNames,
    clientFactory: options.clientFactory,
    multiSite: options.multiSite,
    resolveSite: options.resolveSite,
  };
}

/**
 * Auto-generates ConsentToolConfig from the mode registry and collections.
 *
 * Maps each mode to its display info and the collections it contains,
 * with all modes selected by default.
 */
export function buildConsentToolConfig(
  options: HostedMcpServerOptions
): ConsentToolConfig | undefined {
  if (!options.enableConsentToolSelection) return undefined;

  // Main server modes
  const modes: ConsentModeOption[] = options.modeRegistry.map((m) => ({
    name: m.name,
    displayName: m.displayName,
    description: m.description,
    collections: options.collections
      .filter((c) => m.collections.includes(c.metadata.name))
      .map((c) => ({
        name: c.metadata.name,
        displayName: c.metadata.displayName,
        description: c.metadata.description,
      })),
    defaultSelected: false,
  }));

  // Append chained server modes with prefixed names
  if (options.chainedServers) {
    for (const chained of options.chainedServers) {
      for (const m of chained.modeRegistry) {
        modes.push({
          name: `${chained.name}:${m.name}`,
          displayName: m.displayName,
          description: m.description,
          collections: chained.collections
            .filter((c) => m.collections.includes(c.metadata.name))
            .map((c) => ({
              name: `${chained.name}:${c.metadata.name}`,
              displayName: c.metadata.displayName,
              description: c.metadata.description,
            })),
          defaultSelected: false,
          group: chained.displayName,
        });
      }
    }
  }

  // Collect and deduplicate slices from main server and all chained servers
  const sliceSet = new Set<string>();
  for (const s of options.allSliceNames) {
    if (s !== "other") sliceSet.add(s);
  }
  if (options.chainedServers) {
    for (const chained of options.chainedServers) {
      for (const s of chained.allSliceNames) {
        if (s !== "other") sliceSet.add(s);
      }
    }
  }

  return {
    modes,
    slices: [...sliceSet].map((s) => ({
      name: s,
      displayName: s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " "),
      defaultSelected: true,
    })),
    showReadOnlyToggle: true,
  };
}

/**
 * Creates the default handler for non-MCP routes.
 *
 * Handles:
 * - `/authorize` (or `/authorize/:siteId`) - Consent screen + Umbraco redirect
 * - `/callback` (or `/callback/:siteId`) - Token exchange + MCP client redirect
 * - `/` - Landing page with server info (or site listing for multi-site)
 *
 * This is used as the `defaultHandler` in the OAuthProvider config.
 * Returns an ExportedHandler-compatible object with a `fetch` method,
 * as required by @cloudflare/workers-oauth-provider.
 *
 * @param options - Server configuration
 * @returns ExportedHandler object for non-MCP routes
 */
export function createDefaultHandler(options: HostedMcpServerOptions) {
  return {
    async fetch(request: Request, env: HostedMcpEnv): Promise<Response> {
      // Resolve enableConsentToolSelection: explicit option wins, then env var fallback
      const enableConsent = options.enableConsentToolSelection
        ?? env.ENABLE_CONSENT_TOOL_SELECTION === "true";
      const optionsWithConsent = enableConsent
        ? { ...options, enableConsentToolSelection: true }
        : options;

      // Build consent tool config (only if enableConsentToolSelection resolved to true)
      const consentToolConfig = buildConsentToolConfig(optionsWithConsent);

      // Merge auto-generated tool config and multi-site config into auth options.
      // Use the server name as the consent screen server name if not explicitly set.
      const effectiveAuthOptions: UmbracoAuthHandlerOptions = {
        serverName: options.name,
        ...options.authOptions,
        ...(consentToolConfig ? { consentToolConfig } : {}),
        ...(options.multiSite ? { sites: options.multiSite.sites } : {}),
      };

      return handleDefaultRequest(request, env, options, effectiveAuthOptions);
    },
  };
}

/**
 * OAuthProvider fetch interface (subset used by createWorkerExport).
 */
interface OAuthProviderLike {
  fetch(request: Request, env: HostedMcpEnv, ctx: ExecutionContext): Promise<Response>;
}

/**
 * Creates the Worker export that wraps OAuthProvider with URL rewriting.
 *
 * OAuthProvider uses `pathname.startsWith(apiRoute)` to match the MCP
 * endpoint. Setting `apiRoute: "/"` would match ALL paths, breaking
 * OAuth endpoints. So we keep `apiRoute: "/mcp"` internally and rewrite
 * incoming requests to `/` → `/mcp` before passing to OAuthProvider.
 *
 * - **Browser GET to `/`** (no auth header, not SSE) → serve landing page
 * - **MCP request to `/`** (POST, GET+SSE, DELETE with auth) → rewrite to `/mcp`
 * - **Everything else** (`/authorize`, `/callback`, `/info`, etc.) → pass through
 *
 * @param oauthProvider - The OAuthProvider instance (apiRoute must be "/mcp")
 * @param options - Server configuration (used for landing page rendering)
 */
export function createWorkerExport(
  oauthProvider: OAuthProviderLike,
  options: HostedMcpServerOptions,
) {
  return {
    async fetch(request: Request, env: HostedMcpEnv, ctx: ExecutionContext): Promise<Response> {
      // Fix protocol behind reverse proxies / tunnels (e.g. cloudflared).
      // The proxy→worker hop is plain HTTP, but OAuthProvider derives
      // discovery-document URLs from the request origin. Without this,
      // they end up as http:// which clients like ChatGPT reject.
      const proto = request.headers.get("x-forwarded-proto");
      if (proto === "https" && new URL(request.url).protocol === "http:") {
        const url = new URL(request.url);
        url.protocol = "https:";
        request = new Request(url.toString(), request);
      }

      const url = new URL(request.url);

      if (url.pathname === "/") {
        const method = request.method;
        const hasAuth = request.headers.has("Authorization");
        const acceptsSSE = request.headers.get("Accept")?.includes("text/event-stream");

        // Browser visit: plain GET with no auth and not SSE → landing page
        if (method === "GET" && !hasAuth && !acceptsSSE) {
          if (options.multiSite) {
            return renderMultiSiteLandingResponse(options.name, options.version, options.multiSite);
          }
          return renderLandingPageResponse(options.name, options.version, env.UMBRACO_BASE_URL);
        }

        // MCP request: rewrite / → /mcp so OAuthProvider routes it correctly
        const rewrittenUrl = new URL(request.url);
        rewrittenUrl.pathname = "/mcp";
        const rewrittenRequest = new Request(rewrittenUrl.toString(), request);
        return oauthProvider.fetch(rewrittenRequest, env, ctx);
      }

      // All other paths pass through to OAuthProvider unchanged
      return oauthProvider.fetch(request, env, ctx);
    },
  };
}

// ============================================================================
// Internal Route Handling
// ============================================================================

async function handleDefaultRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions,
  effectiveAuthOptions: UmbracoAuthHandlerOptions
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Multi-site routing
  if (options.multiSite) {
    return handleMultiSiteRequest(request, env, options, effectiveAuthOptions, path);
  }

  // Single-site routing
  return handleSingleSiteRequest(request, env, options, effectiveAuthOptions, path);
}

async function handleSingleSiteRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions,
  authOptions: UmbracoAuthHandlerOptions,
  path: string,
): Promise<Response> {
  // Handle MCP client authorization (consent screen + redirect to Umbraco)
  if (path === "/authorize") {
    return handleAuthorize(request, env, authOptions);
  }

  // Handle Umbraco OAuth callback — exchange code, then complete MCP auth
  if (path === "/callback") {
    return handleCallback(request, env);
  }

  // Handle logout callback (reauth flow: Umbraco signout redirects here)
  if (path === "/logout-callback") {
    return handleLogoutCallback(request, env);
  }

  // Diagnostic endpoint (dev-only)
  if (path === "/info" && env.ENABLE_INFO_ENDPOINT === "true") {
    return renderInfoResponse(options, env);
  }

  return new Response("Not Found", { status: 404 });
}

async function handleMultiSiteRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions,
  authOptions: UmbracoAuthHandlerOptions,
  path: string,
): Promise<Response> {
  const multiSite = options.multiSite!;

  // Authorize — single endpoint, consent form includes site picker.
  // Site selection happens in the consent form, not via separate /authorize/:siteId
  // endpoints, because MCP OAuth discovery only supports a single authorization_endpoint.
  if (path === "/authorize") {
    return handleAuthorize(request, env, authOptions);
  }

  // Callback — match /callback/:siteId for multi-site.
  // The siteId in the path matches what was registered as the redirect_uri with
  // Umbraco during authorize. Site-specific credentials are stored in KV state
  // and consumed by the callback handler directly — no env overlay needed.
  const callbackMatch = path.match(/^\/callback\/([^/]+)$/);
  if (callbackMatch) {
    const siteId = callbackMatch[1];
    const site = multiSite.sites.find((s) => s.id === siteId);
    if (!site) {
      return new Response(JSON.stringify({ error: `Unknown site: ${siteId}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handleCallback(request, env);
  }

  // Also handle /callback without siteId (fallback)
  if (path === "/callback") {
    return handleCallback(request, env);
  }

  // Handle logout callback (reauth flow: Umbraco signout redirects here)
  if (path === "/logout-callback") {
    return handleLogoutCallback(request, env);
  }

  // Diagnostic endpoint (dev-only)
  if (path === "/info" && env.ENABLE_INFO_ENDPOINT === "true") {
    return renderMultiSiteInfoResponse(options, env, multiSite);
  }

  return new Response("Not Found", { status: 404 });
}

// ============================================================================
// Authorize / Callback Handlers
// ============================================================================

async function handleAuthorize(
  request: Request,
  env: HostedMcpEnv,
  authOptions: UmbracoAuthHandlerOptions,
): Promise<Response> {
  try {
    const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const authorizeHandler = createAuthorizeHandler(env, authOptions);
    return authorizeHandler(request, authRequest);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authorization request failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleLogoutCallback(
  request: Request,
  env: HostedMcpEnv,
): Promise<Response> {
  const handler = createLogoutCallbackHandler(env);
  return handler(request);
}

async function handleCallback(
  request: Request,
  env: HostedMcpEnv,
): Promise<Response> {
  try {
    const callbackHandler = createCallbackHandler(env);
    const result = await callbackHandler(request);

    // Complete the MCP OAuth flow: issue an authorization code
    // for the MCP client and redirect back to it.
    // Consent choices (including siteId) are already in result.props
    // from KV state — no need to inject them here.
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: result.authRequest,
      userId: result.props.userId,
      metadata: { userName: result.props.userName },
      scope: result.authRequest.scope,
      props: result.props,
    });

    return Response.redirect(redirectTo, 302);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// Landing Pages
// ============================================================================

function renderLandingPageResponse(
  name: string,
  version: string,
  umbracoUrl: string
): Response {
  return new Response(
    renderLandingPage(name, version, umbracoUrl),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
      },
    }
  );
}

function renderMultiSiteLandingResponse(
  name: string,
  version: string,
  multiSite: MultiSiteConfig
): Response {
  return new Response(
    renderMultiSiteLandingPage(name, version, multiSite),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
      },
    }
  );
}

function renderLandingPage(
  name: string,
  version: string,
  umbracoUrl: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)} - Hosted MCP Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; margin: 0;
    }
    .card {
      background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      max-width: 480px; width: 100%; padding: 2rem; text-align: center;
    }
    h1 { color: #1b264f; font-size: 1.5rem; margin-bottom: 0.5rem; }
    .version { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .info { text-align: left; font-size: 0.9rem; color: #444; }
    .info dt { font-weight: 600; margin-top: 0.75rem; }
    .info dd { margin-left: 0; color: #666; }
    code { background: #f0f0f0; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(name)}</h1>
    <div class="version">v${escapeHtml(version)}</div>
    <dl class="info">
      <dt>MCP Endpoint</dt>
      <dd><code>/</code></dd>
      <dt>Umbraco Instance</dt>
      <dd><code>${escapeHtml(umbracoUrl)}</code></dd>
      <dt>Transport</dt>
      <dd>Streamable HTTP (MCP 2025-03-26)</dd>
    </dl>
  </div>
</body>
</html>`;
}

function renderMultiSiteLandingPage(
  name: string,
  version: string,
  multiSite: MultiSiteConfig
): string {
  const siteRows = multiSite.sites
    .map(
      (site) => `
      <tr>
        <td><strong>${escapeHtml(site.displayName)}</strong></td>
        <td><code>${escapeHtml(site.baseUrl)}</code></td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)} - Hosted MCP Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; margin: 0;
    }
    .card {
      background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      max-width: 600px; width: 100%; padding: 2rem; text-align: center;
    }
    h1 { color: #1b264f; font-size: 1.5rem; margin-bottom: 0.5rem; }
    .version { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .info { text-align: left; font-size: 0.9rem; color: #444; margin-bottom: 1rem; }
    .info dt { font-weight: 600; margin-top: 0.75rem; }
    .info dd { margin-left: 0; color: #666; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; }
    th { color: #666; font-size: 0.75rem; text-transform: uppercase; padding: 0.5rem 0.75rem; border-bottom: 2px solid #eee; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f0f0f0; color: #444; }
    code { background: #f0f0f0; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.85rem; }
    .transport { margin-top: 1rem; font-size: 0.8rem; color: #888; }
    .note { margin-top: 0.75rem; font-size: 0.8rem; color: #888; font-style: italic; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(name)}</h1>
    <div class="version">v${escapeHtml(version)}</div>
    <dl class="info">
      <dt>MCP Endpoint</dt>
      <dd><code>/</code></dd>
    </dl>
    <table>
      <thead>
        <tr>
          <th>Site</th>
          <th>Umbraco Instance</th>
        </tr>
      </thead>
      <tbody>${siteRows}
      </tbody>
    </table>
    <div class="note">Site selection happens during authorization.</div>
    <div class="transport">Streamable HTTP (MCP 2025-03-26)</div>
  </div>
</body>
</html>`;
}

// ============================================================================
// Info Endpoint
// ============================================================================

function renderInfoResponse(
  options: HostedMcpServerOptions,
  env: HostedMcpEnv,
): Response {
  const workerConfig = loadWorkerConfig(env);
  const info: Record<string, unknown> = {
    name: options.name,
    version: options.version,
    transport: "streamable-http",
    mcpEndpoint: "/",
    collections: options.collections.map((c) => ({
      name: c.metadata.name,
      displayName: c.metadata.displayName,
      toolCount: c.tools(undefined).length,
    })),
    modes: [...options.allModeNames],
    slices: [...options.allSliceNames].filter((s) => s !== "other"),
    config: workerConfig,
  };

  if (options.chainedServers && options.chainedServers.length > 0) {
    info.chainedServers = options.chainedServers.map((cs) => ({
      name: cs.name,
      displayName: cs.displayName,
      collections: cs.collections.map((c) => ({
        name: c.metadata.name,
        displayName: c.metadata.displayName,
        toolCount: c.tools(undefined).length,
      })),
      modes: [...cs.allModeNames],
    }));
  }

  return Response.json(info);
}

function renderMultiSiteInfoResponse(
  options: HostedMcpServerOptions,
  env: HostedMcpEnv,
  multiSite: MultiSiteConfig,
): Response {
  const workerConfig = loadWorkerConfig(env);
  const info: Record<string, unknown> = {
    name: options.name,
    version: options.version,
    transport: "streamable-http",
    mcpEndpoint: "/",
    collections: options.collections.map((c) => ({
      name: c.metadata.name,
      displayName: c.metadata.displayName,
      toolCount: c.tools(undefined).length,
    })),
    modes: [...options.allModeNames],
    slices: [...options.allSliceNames].filter((s) => s !== "other"),
    config: workerConfig,
    sites: multiSite.sites.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      baseUrl: s.baseUrl,
    })),
  };

  if (options.chainedServers && options.chainedServers.length > 0) {
    info.chainedServers = options.chainedServers.map((cs) => ({
      name: cs.name,
      displayName: cs.displayName,
      collections: cs.collections.map((c) => ({
        name: c.metadata.name,
        displayName: c.metadata.displayName,
        toolCount: c.tools(undefined).length,
      })),
      modes: [...cs.allModeNames],
    }));
  }

  return Response.json(info);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Re-export AuthProps for use in McpAgent type parameters
export type { AuthProps };
