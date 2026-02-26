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
 * - The default handler (callback, landing page)
 * - Helper to wire everything together
 */

import type {
  ToolCollectionExport,
  ToolModeDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import {
  createAuthorizeHandler,
  createCallbackHandler,
  type AuthProps,
  type UmbracoAuthHandlerOptions,
} from "../auth/umbraco-handler.js";
import { type CreateServerOptions } from "./create-server.js";

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
  };
}

/**
 * Creates the default handler for non-MCP routes.
 *
 * Handles:
 * - `/callback` - Umbraco OAuth callback (token exchange)
 * - `/` - Landing page with server info
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
      return handleDefaultRequest(request, env, options);
    },
  };
}

async function handleDefaultRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions
): Promise<Response> {
  const url = new URL(request.url);

  // Handle MCP client authorization (consent screen + redirect to Umbraco)
  if (url.pathname === "/authorize") {
    try {
      const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const authorizeHandler = createAuthorizeHandler(env, options.authOptions);
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

  // Handle Umbraco OAuth callback — exchange code, then complete MCP auth
  if (url.pathname === "/callback") {
    try {
      const callbackHandler = createCallbackHandler(env);
      const result = await callbackHandler(request);

      // Complete the MCP OAuth flow: issue an authorization code
      // for the MCP client and redirect back to it
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

  // Landing page
  if (url.pathname === "/" || url.pathname === "") {
    return new Response(
      renderLandingPage(options.name, options.version, env.UMBRACO_BASE_URL),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Frame-Options": "DENY",
        },
      }
    );
  }

  return new Response("Not Found", { status: 404 });
}

// Re-export AuthProps for use in McpAgent type parameters
export type { AuthProps };

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
  <title>${name} - Hosted MCP Server</title>
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
    <h1>${name}</h1>
    <div class="version">v${version}</div>
    <dl class="info">
      <dt>MCP Endpoint</dt>
      <dd><code>/mcp</code></dd>
      <dt>Umbraco Instance</dt>
      <dd><code>${umbracoUrl}</code></dd>
      <dt>Transport</dt>
      <dd>Streamable HTTP (MCP 2025-03-26)</dd>
    </dl>
  </div>
</body>
</html>`;
}
