#!/usr/bin/env node
/**
 * Test Echo MCP Server
 *
 * A minimal MCP server used for integration testing.
 * Provides simple echo and add tools for testing the client manager.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "test-echo-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Handle tools/list
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echoes the input message",
      inputSchema: {
        type: "object" as const,
        properties: {
          message: { type: "string", description: "The message to echo" },
        },
        required: ["message"],
      },
    },
    {
      name: "add",
      description: "Adds two numbers",
      inputSchema: {
        type: "object" as const,
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" },
        },
        required: ["a", "b"],
      },
    },
  ],
}));

// Handle tools/call
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "echo") {
    const message = args?.message as string;
    return {
      content: [{ type: "text", text: `Echo: ${message}` }],
    };
  }

  if (name === "add") {
    const a = args?.a as number;
    const b = args?.b as number;
    const sum = a + b;
    return {
      content: [{ type: "text", text: `Sum: ${sum}` }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
