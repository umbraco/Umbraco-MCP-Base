#!/usr/bin/env node
/**
 * Test Legacy Result MCP Server
 *
 * Mimics a chained server built on an SDK version before
 * umbraco/Umbraco-MCP-Base#343: its outputSchema is closed
 * (`additionalProperties: false`) and its error results carry the
 * ProblemDetails as `structuredContent`. A v1.x `Client.callTool()` that has
 * listed tools rejects both results with -32602; the chain client must not.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "test-legacy-result-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get-thing",
      description: "Gets a thing, or fails with ProblemDetails when fail is true",
      inputSchema: {
        type: "object" as const,
        properties: { fail: { type: "boolean" } },
      },
      outputSchema: {
        type: "object" as const,
        properties: { alias: { type: "string" } },
        required: ["alias"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.arguments?.fail) {
    const problem = { type: "Error", title: "Parent not found", status: 404, operationStatus: "ParentNotFound" };
    return {
      content: [{ type: "text", text: JSON.stringify(problem) }],
      structuredContent: problem,
      isError: true,
    };
  }

  // A field the closed outputSchema doesn't list, as when an add-on minor
  // release adds a response property.
  const thing = { alias: "a", visibleWhen: null };
  return {
    content: [{ type: "text", text: JSON.stringify(thing) }],
    structuredContent: thing,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
