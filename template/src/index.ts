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
import {
  configureApiClient,
  createToolAnnotations,
} from "@umbraco-cms/mcp-toolkit";

// Import the Orval-generated API client
import { getExampleUmbracoAddOnAPI } from "./api/generated/exampleApi.js";

// Import tool collections
import exampleCollection from "./tools/example/index.js";

// Configure the API client for use with toolkit helpers
// This connects your generated Orval client to executeGetApiCall, executeVoidApiCall, etc.
configureApiClient(() => getExampleUmbracoAddOnAPI());

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP Server started with ${collections.length} collection(s)`);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
