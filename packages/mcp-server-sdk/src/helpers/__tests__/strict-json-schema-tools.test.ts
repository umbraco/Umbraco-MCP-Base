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

const noopHandler = async () => ({ content: [{ type: "text" as const, text: "ok" }] });

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
        noopHandler,
      );
    });

    const tool = result.tools.find((t) => t.name === "get-notification")!;
    expect(tool.inputSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  it("advertises draft-2020-12 instead of the SDK's draft-7 default", async () => {
    const result = await listToolsOverTheWire((server) => {
      server.registerTool(
        "get-notification",
        {
          description: "Get a notification by ID",
          inputSchema: { id: z.string().describe("Notification ID") },
          outputSchema: { title: z.string() },
        },
        noopHandler,
      );
      // Called after registration — McpServer only advertises the
      // "tools" capability (required to override ListTools at all)
      // once a tool has actually been registered.
      useDraft202012ToolSchemas(server);
    });

    const tool = result.tools.find((t) => t.name === "get-notification");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(tool!.outputSchema?.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("preserves the real property shape from a raw ZodRawShape inputSchema", async () => {
    const result = await listToolsOverTheWire((server) => {
      server.registerTool(
        "get-notification",
        { description: "Get a notification by ID", inputSchema: { id: z.string() } },
        noopHandler,
      );
      useDraft202012ToolSchemas(server);
    });

    const tool = result.tools.find((t) => t.name === "get-notification")!;
    expect(tool.inputSchema.properties).toEqual({ id: { type: "string" } });
    expect(tool.inputSchema.required).toEqual(["id"]);
  });

  it("preserves the real property shape from an already-built Zod object schema", async () => {
    // register-chained-tools.ts passes a full z.ZodObject (not a raw
    // shape) for proxied tools — must be handled without double-wrapping.
    const result = await listToolsOverTheWire((server) => {
      server.registerTool(
        "demo--get-notification",
        { description: "Proxied tool", inputSchema: z.object({ id: z.string() }) },
        noopHandler,
      );
      useDraft202012ToolSchemas(server);
    });

    const tool = result.tools.find((t) => t.name === "demo--get-notification")!;
    expect(tool.inputSchema.properties).toEqual({ id: { type: "string" } });
  });

  it("falls back to an empty object schema for a tool with no inputSchema", async () => {
    const result = await listToolsOverTheWire((server) => {
      server.registerTool("no-args", { description: "Takes no arguments" }, noopHandler);
      useDraft202012ToolSchemas(server);
    });

    const tool = result.tools.find((t) => t.name === "no-args")!;
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("picks up tools registered after useDraft202012ToolSchemas was called", async () => {
    // Proves the handler reads the live registry rather than a snapshot
    // taken at patch time — e.g. chained tools registered by a separate,
    // later call still get draft-2020-12 schemas.
    const result = await listToolsOverTheWire((server) => {
      server.registerTool(
        "tool-a",
        { description: "A", inputSchema: { a: z.string() } },
        noopHandler,
      );
      useDraft202012ToolSchemas(server);
      server.registerTool(
        "tool-b",
        { description: "B", inputSchema: { b: z.number() } },
        noopHandler,
      );
    });

    expect(result.tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
    const toolB = result.tools.find((t) => t.name === "tool-b")!;
    expect(toolB.inputSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("omits a tool disabled after registration", async () => {
    const result = await listToolsOverTheWire((server) => {
      const registered = server.registerTool(
        "tool-a",
        { description: "A", inputSchema: { a: z.string() } },
        noopHandler,
      );
      useDraft202012ToolSchemas(server);
      registered.disable();
    });

    expect(result.tools.map((t) => t.name)).toEqual([]);
  });

  it("is a no-op when no tool was ever registered", () => {
    // McpServer never advertises the "tools" capability if registerTool
    // was never called, so there is nothing to override — must not throw,
    // otherwise a server that ends up with zero tools (e.g. every tool
    // filtered out by consent) would fail to start entirely.
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    expect(() => useDraft202012ToolSchemas(server)).not.toThrow();
  });
});
