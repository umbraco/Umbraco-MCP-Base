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
} from "../auth/umbraco-handler.js";
import type { ConsentToolConfig } from "../auth/consent.js";
import { type CreateServerOptions, type SiteResolver } from "./create-server.js";
import { loadWorkerConfig } from "../config/worker-config.js";

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

  return {
    modes: options.modeRegistry.map((m) => ({
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
      defaultSelected: true,
    })),
    slices: options.allSliceNames
      .filter((s) => s !== "other")
      .map((s) => ({
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
  // Build consent tool config if enableConsentToolSelection is set
  const consentToolConfig = buildConsentToolConfig(options);

  // Merge auto-generated tool config and multi-site config into auth options
  const effectiveAuthOptions: UmbracoAuthHandlerOptions = {
    ...options.authOptions,
    ...(consentToolConfig ? { consentToolConfig } : {}),
    ...(options.multiSite ? { sites: options.multiSite.sites } : {}),
  };

  return {
    async fetch(request: Request, env: HostedMcpEnv): Promise<Response> {
      return handleDefaultRequest(request, env, options, effectiveAuthOptions);
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

  // Landing page
  if (path === "/" || path === "") {
    return renderLandingPageResponse(options.name, options.version, env.UMBRACO_BASE_URL);
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

  // Landing page with site listing
  if (path === "/" || path === "") {
    return renderMultiSiteLandingResponse(options.name, options.version, multiSite);
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
      <dd><code>/mcp</code></dd>
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
      <dd><code>/mcp</code></dd>
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
  return Response.json({
    name: options.name,
    version: options.version,
    transport: "streamable-http",
    mcpEndpoint: "/mcp",
    collections: options.collections.map((c) => ({
      name: c.metadata.name,
      displayName: c.metadata.displayName,
      toolCount: c.tools(undefined).length,
    })),
    modes: [...options.allModeNames],
    slices: [...options.allSliceNames].filter((s) => s !== "other"),
    config: workerConfig,
  });
}

function renderMultiSiteInfoResponse(
  options: HostedMcpServerOptions,
  env: HostedMcpEnv,
  multiSite: MultiSiteConfig,
): Response {
  const workerConfig = loadWorkerConfig(env);
  return Response.json({
    name: options.name,
    version: options.version,
    transport: "streamable-http",
    mcpEndpoint: "/mcp",
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
  });
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
