#!/usr/bin/env node
/**
 * MCP Server Entry Point
 *
 * This file sets up and starts the MCP server.
 * Customize this to add your tool collections.
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import packageJson from "../package.json" with { type: "json" };
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  configureApiClient,
  createToolAnnotations,
  discoverProxiedTools,
  parseProxiedToolName,
  createCollectionConfigLoader,
  shouldIncludeTool,
  toolToJsonSchema,
  toolToSummary,
  formatToolTable,
  generateContextFile,
  type CollectionConfiguration,
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
import { allModes, allModeNames, allSliceNames, loadServerConfig, clearConfigCache } from "./config/index.js";

// Configure the API client for use with toolkit helpers
// This connects your generated Orval client to executeGetApiCall, executeVoidApiCall, etc.
configureApiClient(() => getExampleUmbracoAddOnAPI());

// ============================================================================
// MCP Server Setup
// ============================================================================

// Create MCP server
const server = new McpServer({
  name: "my-umbraco-mcp",
  version: packageJson.version,
});

// ============================================================================
// Tool Filtering Setup
// ============================================================================

// Clear config cache to ensure fresh config for each server start
clearConfigCache();

// Load server configuration (includes filtering settings from env vars)
const serverConfig = loadServerConfig(true);

// Create collection config loader with our registries
const configLoader = createCollectionConfigLoader({
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
});

// Load filtering configuration from server config
const filterConfig: CollectionConfiguration = configLoader.loadFromConfig(serverConfig.umbraco);

// ============================================================================
// Register Tools with Filtering
// ============================================================================

const collections = [exampleCollection, example2Collection, chainedCollection];
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

    // Register tool with MCP server using registerTool API
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations,
    }, tool.handler);

    registeredToolCount++;
  }
}

// ============================================================================
// CLI Introspection (runs before server start, exits immediately)
// ============================================================================

const cliFlags = serverConfig.cliFlags;

if (cliFlags?.listTools) {
  const summaries = collections.flatMap((col) =>
    col.tools({}).map((tool) => toolToSummary(tool, col.metadata.name))
  );
  console.log(formatToolTable(summaries));
  process.exit(0);
}

if (cliFlags?.describeTool) {
  const toolName = cliFlags.describeTool;
  let found = false;
  for (const col of collections) {
    const tool = col.tools({}).find((t) => t.name === toolName);
    if (tool) {
      const schema = toolToJsonSchema(tool);
      console.log(JSON.stringify({
        name: tool.name,
        collection: col.metadata.name,
        description: tool.description,
        slices: tool.slices,
        annotations: tool.annotations ?? {},
        inputSchema: schema,
      }, null, 2));
      found = true;
      break;
    }
  }
  if (!found) {
    console.error(`Tool '${toolName}' not found. Use --list-tools to see available tools.`);
    process.exit(1);
  }
  process.exit(0);
}

if (cliFlags?.generateContext) {
  const context = generateContextFile(collections, {
    serverName: "my-umbraco-mcp",
    serverVersion: packageJson.version,
  });
  console.log(context);
  process.exit(0);
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
