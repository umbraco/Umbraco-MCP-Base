/**
 * Test Worker for Hosted Chained MCP E2E Tests
 *
 * Combines the template's example collections (main server) with the demo
 * chained MCP (in-process chaining) to test consent screen integration,
 * /info endpoint, and tool listing with chained servers.
 */

// Wrangler virtual modules
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

// Hosted MCP building blocks
import {
  createDefaultHandler,
  createWorkerExport,
  createPerRequestServer,
  registerChainedTools,
  getServerOptions,
  type HostedMcpEnv,
  type AuthProps,
  type ChainedServerConsentConfig,
} from "@umbraco-cms/mcp-hosted";

import {
  initializeUmbracoFetch,
  isUmbracoFetchInitialized,
} from "@umbraco-cms/mcp-server-sdk";

// Main server collections (from template)
import { collections, allModes, allModeNames, allSliceNames } from "../../../template/src/collections.js";

// Demo chained MCP
import {
  collections as demoCollections,
  allModes as demoModes,
  allModeNames as demoModeNames,
  allSliceNames as demoSliceNames,
} from "../demo-chained-mcp/index.js";

// Demo chained server consent config
const demoChainedServer: ChainedServerConsentConfig = {
  name: "demo",
  displayName: "Demo Add-On",
  modeRegistry: demoModes,
  collections: demoCollections,
  allModeNames: demoModeNames,
  allSliceNames: demoSliceNames,
};

// ============================================================================
// Server Configuration
// ============================================================================

const options = {
  name: "my-umbraco-mcp-chained",
  version: "1.0.0",
  collections,
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
  chainedServers: [demoChainedServer],
  authOptions: { showReauthButton: true },
};

const serverOptions = getServerOptions(options);

// ============================================================================
// McpAgent Durable Object
// ============================================================================

export class UmbracoMcpAgent extends McpAgent<HostedMcpEnv, unknown, AuthProps> {
  server!: McpServer;

  async init() {
    // Initialize the SDK fetch client so chained tools can call the real Umbraco API.
    // Uses client_credentials auth with env vars from wrangler config.
    const env = (this as any).env;
    if (!isUmbracoFetchInitialized() && env.UMBRACO_API_CLIENT_ID && env.UMBRACO_API_CLIENT_SECRET) {
      initializeUmbracoFetch({
        baseUrl: env.UMBRACO_BASE_URL || env.UMBRACO_SERVER_URL,
        clientId: env.UMBRACO_API_CLIENT_ID,
        clientSecret: env.UMBRACO_API_CLIENT_SECRET,
      });
    }

    // Create the main server with template tools
    this.server = await createPerRequestServer(
      serverOptions,
      (this as any).env,
      this.props!,
    );

    // Register proxied demo tools via in-process chaining
    await registerChainedTools({
      server: this.server,
      env: (this as any).env,
      props: this.props!,
      chainedServer: demoChainedServer,
      fetchUser: false,
    });
  }
}

// ============================================================================
// Worker Export
// ============================================================================

const provider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }),
  defaultHandler: createDefaultHandler(options) as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default createWorkerExport(provider, options);
