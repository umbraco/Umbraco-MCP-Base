import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { useDraft202012ToolSchemas } from "../strict-json-schema-tools.js";

/**
 * Round-trips a real McpServer <-> Client over an in-memory transport and
 * returns the raw tools/list response — the same wire format a strict
 * client validates against.
 */
async function listToolsOverTheWire(configure: (server: McpServer) => void) {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  configure(server);

  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.listTools();
  } finally {
    await client.close();
    await server.close();
  }
}

describe("useDraft202012ToolSchemas", () => {
  it("documents the upstream bug: an unpatched McpServer emits draft-7", async () => {
    // @modelcontextprotocol/sdk's ListTools handler never passes a
    // `target`, so it silently falls back to draft-7 — see this file's
    // header comment. If this ever starts failing because the SDK fixed
    // it upstream, useDraft202012ToolSchemas can be retired.
    const result = await listToolsOverTheWire((server) => {
      server.registerTool(
        "get-notification",
        { description: "Get a notification by ID", inputSchema: { id: z.string() } },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
    });

    const tool = result.tools.find((t) => t.name === "get-notification")!;
    expect(tool.inputSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  it("advertises draft-2020-12 instead of the SDK's draft-7 default", async () => {
    const result = await listToolsOverTheWire((server) => {
      useDraft202012ToolSchemas(server);
      server.registerTool(
        "get-notification",
        {
          description: "Get a notification by ID",
          inputSchema: { id: z.string().describe("Notification ID") },
          outputSchema: { title: z.string() },
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
    });

    const tool = result.tools.find((t) => t.name === "get-notification");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(tool!.outputSchema?.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("preserves the real property shape from a raw ZodRawShape inputSchema", async () => {
    const result = await listToolsOverTheWire((server) => {
      useDraft202012ToolSchemas(server);
      server.registerTool(
        "get-notification",
        {
          description: "Get a notification by ID",
          inputSchema: { id: z.string() },
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
    });

    const tool = result.tools.find((t) => t.name === "get-notification")!;
    expect(tool.inputSchema.properties).toEqual({ id: { type: "string" } });
    expect(tool.inputSchema.required).toEqual(["id"]);
  });

  it("preserves the real property shape from an already-built Zod object schema", async () => {
    // register-chained-tools.ts passes a full z.ZodObject (not a raw
    // shape) for proxied tools — must be handled without double-wrapping.
    const result = await listToolsOverTheWire((server) => {
      useDraft202012ToolSchemas(server);
      server.registerTool(
        "demo--get-notification",
        {
          description: "Proxied tool",
          inputSchema: z.object({ id: z.string() }),
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
    });

    const tool = result.tools.find((t) => t.name === "demo--get-notification")!;
    expect(tool.inputSchema.properties).toEqual({ id: { type: "string" } });
  });

  it("falls back to an empty object schema for a tool with no inputSchema", async () => {
    const result = await listToolsOverTheWire((server) => {
      useDraft202012ToolSchemas(server);
      server.registerTool(
        "no-args",
        { description: "Takes no arguments" },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
    });

    const tool = result.tools.find((t) => t.name === "no-args")!;
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("keeps every tool registered from multiple registerTool calls in the list", async () => {
    const result = await listToolsOverTheWire((server) => {
      useDraft202012ToolSchemas(server);
      server.registerTool(
        "tool-a",
        { description: "A", inputSchema: { a: z.string() } },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
      server.registerTool(
        "tool-b",
        { description: "B", inputSchema: { b: z.number() } },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );
    });

    expect(result.tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
  });
});
