#!/usr/bin/env node
/**
 * MCP Server Entry Point
 *
 * This file sets up and starts the MCP server.
 * Customize this to add your tool collections.
 */

import "./load-env.js";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import packageJson from "../package.json" with { type: "json" };
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  configureApiClient,
  initializeUmbracoFetch,
  createToolAnnotations,
  discoverProxiedTools,
  parseProxiedToolName,
  createCollectionConfigLoader,
  shouldIncludeTool,
  handleCliCommands,
  runStartupVersionCheck,
  registerToolCollection,
  UmbracoManagementClient,
  CAPTURE_RAW_HTTP_RESPONSE,
  SERVER_INFORMATION_PATH,
  useDraft202012ToolSchemas,
  type CollectionConfiguration,
  type HttpResponse,
} from "@umbraco-cms/mcp-server-sdk";

// Import the Orval-generated API client
import { getExampleUmbracoAddOnAPI } from "./umbraco-api/api/generated/exampleApi.js";

// Import tool collections
import exampleCollection from "./umbraco-api/tools/example/index.js";
import example2Collection from "./umbraco-api/tools/example-2/index.js";
import chainedCollection from "./umbraco-api/tools/chained/index.js";

// Import MCP client manager (for chaining to other MCP servers)
import { mcpClientManager } from "./umbraco-api/mcp-client.js";

// Import MCP server chain configuration
import { mcpServers } from "./config/mcp-servers.js";

// Import registries for tool filtering
import {
  allModes,
  allModeNames,
  allSliceNames,
  loadServerConfig,
  clearConfigCache,
  UMBRACO_TARGET_MAJOR,
} from "./config/index.js";

// Initialize the SDK's fetch client for real Umbraco API calls.
// This enables the Orval-generated client to authenticate via client_credentials.
const baseUrl = process.env.UMBRACO_BASE_URL || "http://localhost:44391";
const clientId = process.env.UMBRACO_CLIENT_ID || "";
const clientSecret = process.env.UMBRACO_CLIENT_SECRET || "";
// A config the SDK refuses (e.g. TLS verification disabled for a remote site)
// is rethrown after the offline CLI commands below, so they
// (--list-tools, --describe-tool, --debug-config, ...) still work to diagnose it.
let fetchInitError: unknown;
if (clientId) {
  try {
    initializeUmbracoFetch({ baseUrl, clientId, clientSecret });
  } catch (error) {
    fetchInitError = error;
  }
}

// Configure the API client for use with toolkit helpers
// This connects your generated Orval client to executeGetApiCall, executeVoidApiCall, etc.
configureApiClient(() => getExampleUmbracoAddOnAPI());

// ============================================================================
// Tool Filtering Setup
// ============================================================================

// Clear config cache to ensure fresh config for each server start
clearConfigCache();

// Load server configuration (includes filtering settings from env vars)
const serverConfig = await loadServerConfig(true);

// Create collection config loader with our registries
const configLoader = createCollectionConfigLoader({
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
});

// Load filtering configuration from server config
const filterConfig: CollectionConfiguration = configLoader.loadFromConfig(serverConfig.umbraco);

// ============================================================================
// CLI Introspection (runs before server start, exits immediately)
// ============================================================================

const collections = [exampleCollection, example2Collection, chainedCollection];

// --call talks to Umbraco, so it reports a refused config instead of running the tool.
if (fetchInitError && serverConfig.cliFlags?.callTool) throw fetchInitError;

// handleCliCommands checks --list-tools, --describe-tool, --generate-context, --call.
// If any flag is set it prints output, waits for it to flush, and exits
// (0 on success, 1 on error).
// Otherwise it returns and the server continues to start.
await handleCliCommands(collections, {
  cliFlags: serverConfig.cliFlags,
  serverName: "my-umbraco-mcp",
  serverVersion: packageJson.version,
  filterConfig,
  serverConfig: serverConfig.umbraco,
});

if (fetchInitError) throw fetchInitError;

// ============================================================================
// Version Check
// ============================================================================
//
// Verify the connected Umbraco major matches the major this server's tools
// were generated against. `runStartupVersionCheck` (from the SDK) does the
// whole guard in one call:
//   - resolves the expected major: a non-blank `UMBRACO_EXPECTED_MAJOR` /
//     `--umbraco-expected-major` (see `config/server-config.ts`), else
//     `UMBRACO_TARGET_MAJOR` from `config/umbraco-target.generated.ts`, which
//     `npm run generate` stamps from the Umbraco instance in `.env`;
//   - asks Umbraco for its version under a 5 s deadline (token request
//     included). A timeout or an unreachable CMS is a warning, never a block;
//   - on a mismatch, blocks the first tool call with the warning until the
//     user deliberately retries;
//   - returns the warning for the server's `instructions` (null otherwise).
// It never throws. A parent MCP server that chains this one and runs its own
// guard sets `UMBRACO_MCP_SKIP_VERSION_CHECK=true` in this process's env, which
// makes the call a no-op so a mismatch isn't reported twice.
//
// Skipped when no client credentials are configured (matches the
// `initializeUmbracoFetch` gate above) so CLI introspection / offline usage
// never makes a live network call.
const versionCheckMessage = clientId
  ? await runStartupVersionCheck({
      expectedUmbracoMajorOverride: serverConfig.custom.expectedUmbracoMajor,
      generatedUmbracoMajor: UMBRACO_TARGET_MAJOR,
      mcpVersion: packageJson.version,
      client: {
        getServerInformation: async ({ signal } = {}) => {
          const response = (await UmbracoManagementClient<{ version: string }>(
            { url: SERVER_INFORMATION_PATH, method: "GET" },
            { ...CAPTURE_RAW_HTTP_RESPONSE, signal },
          )) as unknown as HttpResponse<{ version: string }>;
          return { version: response.data.version };
        },
      },
    })
  : null;

// ============================================================================
// MCP Server Setup
// ============================================================================

// Create MCP server.
// Pass an optional `instructions` string in the second argument to send
// server-level guidance to clients during `initialize`. Most clients fold
// this into the model's system prompt, so it applies implicitly without
// per-tool repetition. Mirror the same value in `worker.ts` so stdio and
// hosted deployments behave consistently.
//
// Here it's used to surface a version-mismatch warning when one was detected
// (null otherwise). Extend the string if you also want custom guidance, e.g.:
// [versionCheckMessage, "Refer to items by name, not by ID."].filter(Boolean).join("\n\n")
const server = new McpServer(
  { name: "my-umbraco-mcp", version: packageJson.version },
  versionCheckMessage ? { instructions: versionCheckMessage } : undefined,
);

// ============================================================================
// Register Tools with Filtering
// ============================================================================

let registeredToolCount = 0;

for (const collection of collections) {
  const collectionName = collection.metadata.name;

  // Get tools for current user (pass user context if needed)
  const tools = collection.tools({});

  for (const tool of tools) {
    // Check if tool should be included based on filtering config
    if (!shouldIncludeTool(tool, { collectionName, config: filterConfig })) {
      continue;
    }

    // Build annotations from tool definition
    const annotations = createToolAnnotations(tool);

    // Record the owning collection so telemetry spans can be grouped by it.
    // Only this loop knows both the tool and its collection — the decorators
    // are applied in each tool's own file, before collections are assembled.
    registerToolCollection(tool.name, collectionName);

    // Register tool with MCP server using registerTool API
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations,
    }, tool.handler as ToolCallback<typeof tool.inputSchema>);

    registeredToolCount++;
  }
}

// Start the server
async function main() {
  // Discover and register proxied tools from chained MCP servers
  // Skip if chaining is disabled via config (DISABLE_MCP_CHAINING=true)
  const chainingEnabled = mcpServers.length > 0 && !serverConfig.custom.disableMcpChaining;

  if (chainingEnabled) {
    try {
      const proxiedTools = await discoverProxiedTools(mcpClientManager);

      for (const pt of proxiedTools) {
        // Register proxied tool with forwarding handler
        // Note: We don't pass inputSchema since validation happens on the chained server
        // and the MCP SDK expects Zod schemas, not raw JSON Schema objects
        server.registerTool(
          pt.prefixedName,
          {
            description: `[Proxied from ${pt.serverName}] ${pt.originalTool.description || "No description"}`,
          },
          async (args: Record<string, unknown>): Promise<CallToolResult> => {
            const { serverName, toolName } = parseProxiedToolName(pt.prefixedName);
            const result = await mcpClientManager.callTool(serverName, toolName, args);
            return result as CallToolResult;
          }
        );
      }

      if (proxiedTools.length > 0) {
        console.error(`Registered ${proxiedTools.length} proxied tool(s) from chained MCP servers`);
      }
    } catch (error) {
      console.error("Warning: Failed to discover proxied tools:", error);
      // Continue without proxied tools - local tools still work
    }
  }

  // Called once, after every registerTool call above (main collections at
  // module load, chained tools just above) has completed — McpServer only
  // advertises the "tools" capability required to override ListTools at
  // all once at least one tool has actually been registered.
  useDraft202012ToolSchemas(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP Server started with ${registeredToolCount} tool(s) from ${collections.length} collection(s)`);
}

// Cleanup on shutdown
process.on("SIGINT", async () => {
  await mcpClientManager.disconnectAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await mcpClientManager.disconnectAll();
  process.exit(0);
});

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
