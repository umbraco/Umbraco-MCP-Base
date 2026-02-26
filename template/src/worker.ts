/**
 * Cloudflare Worker Entry Point
 *
 * Hosted MCP server deployment for Cloudflare Workers.
 * Uses the same tool collections as the stdio entry point (index.ts)
 * but runs over Streamable HTTP with OAuth authentication.
 *
 * NOTE: This file is built by wrangler (not tsup) because it uses
 * Wrangler virtual modules (`agents/mcp`, `@cloudflare/workers-oauth-provider`).
 *
 * Deployment:
 *   npx wrangler dev     # Local development
 *   npx wrangler deploy  # Production deployment
 *
 * See wrangler.toml for configuration.
 */

// Wrangler virtual modules (resolved at wrangler build time)
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

// Hosted MCP building blocks
import {
  createDefaultHandler,
  createPerRequestServer,
  getServerOptions,
  type HostedMcpEnv,
  type AuthProps,
} from "@umbraco-cms/mcp-hosted";

// Import tool collections (same as stdio mode)
import exampleCollection from "./umbraco-api/tools/example/index.js";
import example2Collection from "./umbraco-api/tools/example-2/index.js";

// Import registries for tool filtering (same as stdio mode)
import { allModes, allModeNames, allSliceNames } from "./config/index.js";

// ============================================================================
// Server Configuration
// ============================================================================

const options = {
  name: "my-umbraco-mcp",
  version: "1.0.0",
  collections: [exampleCollection, example2Collection],
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
};

const serverOptions = getServerOptions(options);

// ============================================================================
// McpAgent Durable Object
// ============================================================================

/**
 * Durable Object class for stateful MCP sessions.
 * Each MCP client connection gets its own instance.
 * Wrangler resolves `McpAgent` from the `agents/mcp` virtual module.
 */
export class UmbracoMcpAgent extends McpAgent<HostedMcpEnv, unknown, AuthProps> {
  server: McpServer | undefined;

  async init() {
    this.server = await createPerRequestServer(
      serverOptions,
      this.env,
      this.props
    );
  }
}

// ============================================================================
// Worker Export
// ============================================================================

/**
 * Main Worker fetch handler wrapped with OAuthProvider.
 *
 * OAuthProvider (from `@cloudflare/workers-oauth-provider`) handles:
 * - /.well-known/oauth-authorization-server (metadata discovery)
 * - /authorize (authorization endpoint)
 * - /token (token endpoint)
 * - /register (dynamic client registration - RFC 7591)
 * - /mcp (MCP protocol via Streamable HTTP, authenticated)
 */
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }),
  defaultHandler: createDefaultHandler(options),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
