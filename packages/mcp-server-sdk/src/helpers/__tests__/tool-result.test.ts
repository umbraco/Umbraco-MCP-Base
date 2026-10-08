import { describe, it, expect, afterEach } from "@jest/globals";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { configureToolResultMode, createToolResult, createToolResultError } from "../tool-result.js";

const problem = { type: "Error", title: "Internal Server Error", status: 500, detail: "boom" };

describe("createToolResultError", () => {
  afterEach(() => {
    configureToolResultMode(false);
  });

  it("sends the error as JSON text content, never as structuredContent", () => {
    const result = createToolResultError(problem);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(problem);
  });

  it("still sends the text content in structured-only mode", () => {
    configureToolResultMode(true);

    const result = createToolResultError(problem);

    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(problem);
  });

  it("sends a string error as-is", () => {
    const result = createToolResultError("Failed to get document");

    expect(result.content[0].text).toBe("Failed to get document");
  });

  it("leaves success results unchanged", () => {
    const result = createToolResult({ alias: "a" });

    expect(result.structuredContent).toEqual({ alias: "a" });
  });
});

describe("error results through a validating Client (umbraco/Umbraco-MCP-Base#343)", () => {
  it("delivers the ProblemDetails instead of an output schema mismatch", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    server.registerTool(
      "list-things",
      { outputSchema: z.object({ items: z.array(z.object({ alias: z.string() })) }) },
      async () => createToolResultError(problem) as never,
    );

    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      // Listing first is what makes the v1.x Client cache output validators,
      // as real clients (Claude Desktop, MCP Inspector, the chain client) do.
      await client.listTools();
      const result = await client.callTool({ name: "list-things", arguments: {} });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual(problem);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
