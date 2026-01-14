#!/usr/bin/env node
/**
 * MCP Server Entry Point
 *
 * This file sets up and starts the MCP server.
 * Customize this to add your tool collections.
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  configureApiClient,
  createToolAnnotations,
  createMcpClientManager,
  discoverProxiedTools,
  parseProxiedToolName,
} from "@umbraco-cms/mcp-toolkit";

// Import the Orval-generated API client
import { getExampleUmbracoAddOnAPI } from "./api/generated/exampleApi.js";

// Import tool collections
import exampleCollection from "./tools/example/index.js";

// Import MCP server chain configuration
import { mcpServers } from "./config/mcp-servers.js";

// Configure the API client for use with toolkit helpers
// This connects your generated Orval client to executeGetApiCall, executeVoidApiCall, etc.
configureApiClient(() => getExampleUmbracoAddOnAPI());

// ============================================================================
// MCP Client Manager (for chaining to other MCP servers)
// ============================================================================

/**
 * MCP Client Manager for chaining to other MCP servers.
 * Allows tools in this server to call tools on external MCP servers.
 *
 * Usage in tools:
 * ```typescript
 * import { mcpClientManager } from "../../index.js";
 * const result = await mcpClientManager.callTool("cms", "get-document", { id: "..." });
 * ```
 */
export const mcpClientManager = createMcpClientManager({
  // Pass through any filter configuration to chained servers
  // filterConfig: { tools: [], slices: [], modes: [] },
});

// Register configured MCP servers
for (const config of mcpServers) {
  mcpClientManager.registerServer(config);
}

// ============================================================================
// MCP Server Setup
// ============================================================================

// Create MCP server
const server = new McpServer({
  name: "my-umbraco-mcp",
  version: "1.0.0",
});

// Register tools from collections
const collections = [exampleCollection];

for (const collection of collections) {
  // Get tools for current user (pass user context if needed)
  const tools = collection.tools({});

  for (const tool of tools) {
    // Build annotations from tool definition
    const annotations = createToolAnnotations(tool);

    // Register tool with MCP server using registerTool API
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations,
    }, tool.handler);
  }
}

// Start the server
async function main() {
  // Discover and register proxied tools from chained MCP servers
  if (mcpServers.length > 0) {
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
  console.error(`MCP Server started with ${collections.length} collection(s)`);
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
