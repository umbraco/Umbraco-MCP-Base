#!/usr/bin/env node
/**
 * Mock MCP Server for Testing
 *
 * A minimal MCP server used for testing MCP chaining functionality.
 * Provides simple tools that can be proxied and called via the chaining mechanism.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mock-cms-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Handle tools/list
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get-server-info",
      description: "Gets mock server information",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "echo-message",
      description: "Echoes the input message",
      inputSchema: {
        type: "object" as const,
        properties: {
          message: { type: "string", description: "The message to echo" },
        },
        required: ["message"],
      },
    },
  ],
}));

// Handle tools/call
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get-server-info") {
    // Return structured content for tools that support it
    const data = {
      name: "Mock CMS Server",
      version: "1.0.0",
      status: "running",
    };
    return {
      content: [],
      structuredContent: data,
    };
  }

  if (name === "echo-message") {
    const message = args?.message as string;
    const data = { echo: `Mock CMS Echo: ${message}` };
    return {
      content: [],
      structuredContent: data,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
