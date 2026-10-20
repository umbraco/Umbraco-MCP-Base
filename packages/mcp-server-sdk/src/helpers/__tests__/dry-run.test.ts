/**
 * Dry-Run Tests
 *
 * Tests for the dry-run mode that intercepts mutation tools.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Use dynamic imports to get fresh module state
async function getDryRunModule() {
  jest.resetModules();
  return await import("../dry-run.js");
}

describe("configureDryRunMode", () => {
  it("should default to disabled", async () => {
    const { isDryRunEnabled } = await getDryRunModule();
    expect(isDryRunEnabled()).toBe(false);
  });

  it("should enable dry-run mode", async () => {
    const { configureDryRunMode, isDryRunEnabled } = await getDryRunModule();
    configureDryRunMode(true);
    expect(isDryRunEnabled()).toBe(true);
  });

  it("should disable dry-run mode", async () => {
    const { configureDryRunMode, isDryRunEnabled } = await getDryRunModule();
    configureDryRunMode(true);
    configureDryRunMode(false);
    expect(isDryRunEnabled()).toBe(false);
  });
});

describe("withDryRun", () => {
  it("should execute handler normally when dry-run is disabled", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(false);

    const handler = jest.fn().mockReturnValue({ content: [{ type: "text", text: "done" }] });
    const tool = {
      name: "test-mutation",
      description: "test",
      handler,
      slices: ["create"],
      annotations: { destructiveHint: true },
    } as any;

    const wrapped = withDryRun(tool);
    await wrapped.handler({ input: "test" } as any, {} as any);
    expect(handler).toHaveBeenCalled();
  });

  it("should execute read-only tools normally in dry-run mode", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn().mockReturnValue({ content: [{ type: "text", text: "data" }] });
    const tool = {
      name: "test-read",
      description: "test",
      handler,
      slices: ["read"],
      annotations: { readOnlyHint: true },
    } as any;

    const wrapped = withDryRun(tool);
    await wrapped.handler({} as any, {} as any);
    expect(handler).toHaveBeenCalled();
  });

  it("should intercept mutation tools in dry-run mode", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn();
    const tool = {
      name: "test-delete",
      description: "delete something",
      handler,
      slices: ["delete"],
      annotations: { destructiveHint: true },
    } as any;

    const wrapped = withDryRun(tool);
    const result = await wrapped.handler({ id: "123" } as any, {} as any);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeDefined();

    // Check the structured content
    const structured = (result as any).structuredContent;
    expect(structured.dryRun).toBe(true);
    expect(structured.toolName).toBe("test-delete");
    expect(structured.wouldExecute).toBe(true);
    expect(structured.inputReceived).toEqual({ id: "123" });
  });

  it("should intercept tools without readOnlyHint in dry-run mode", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn();
    const tool = {
      name: "test-update",
      description: "update something",
      handler,
      slices: ["update"],
      // No annotations — default is not read-only
    } as any;

    const wrapped = withDryRun(tool);
    const result = await wrapped.handler({ data: "new" } as any, {} as any);

    expect(handler).not.toHaveBeenCalled();
    expect((result as any).structuredContent.dryRun).toBe(true);
  });

  it("does not leak the extra/context object as inputReceived for a schema-less tool", async () => {
    // The MCP SDK calls a tool with no inputSchema as `callback(extra)` — one
    // argument, not two. Hard-destructuring `(args, context)` used to bind
    // `extra` to `args`, so this preview would return the internal
    // RequestHandlerExtra (session id, telemetry carrier, etc.) to the client.
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn();
    const tool = {
      name: "test-no-schema",
      description: "no input schema",
      handler,
      slices: ["delete"],
      // No inputSchema — this tool is called as `handler(extra)`.
    } as any;

    const extra = { sessionId: "sess-1", umbracoTelemetry: { tenant: "hash-a" } };
    const wrapped = withDryRun(tool);
    const result = await (wrapped.handler as (...args: any[]) => any)(extra);

    expect(handler).not.toHaveBeenCalled();
    const structured = (result as any).structuredContent;
    expect(structured.inputReceived).toEqual({});
  });

  it("should include annotation info in dry-run response", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn();
    const tool = {
      name: "test-tool",
      description: "test",
      handler,
      slices: [],
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    } as any;

    const wrapped = withDryRun(tool);
    const result = await wrapped.handler({} as any, {} as any);

    const annotations = (result as any).structuredContent.annotations;
    expect(annotations.destructiveHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.readOnlyHint).toBe(false);
  });
});

describe("dry-run over MCP with an outputSchema", () => {
  // Fresh modules per test so dry-run state and the decorators agree on one
  // copy of dry-run.ts.
  async function setup() {
    jest.resetModules();
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { z } = await import("zod");
    const dryRun = await import("../dry-run.js");
    const decorators = await import("../tool-decorators.js");
    const { createToolResult } = await import("../tool-result.js");

    const outputSchema = { id: z.string(), message: z.string() };
    const makeTool = (name: string, annotations: Record<string, boolean> = {}) =>
      ({
        name,
        description: "test tool",
        inputSchema: { name: z.string() },
        outputSchema,
        slices: [],
        annotations: { openWorldHint: true, ...annotations },
        handler: async () => createToolResult({ id: "real-id", message: "real" }),
      }) as any;

    // Registers like a product does: config is loaded (dry-run set) first,
    // then registerTool reads tool.outputSchema.
    async function connect(tools: any[]) {
      const server = new McpServer({ name: "test-server", version: "1.0.0" });
      for (const tool of tools) {
        server.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: tool.annotations,
          },
          tool.handler,
        );
      }
      const client = new Client({ name: "test-client", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      return { client, close: async () => { await client.close(); await server.close(); } };
    }

    return { ...dryRun, ...decorators, makeTool, connect };
  }

  it("returns the preview for a mutation tool via withStandardDecorators", async () => {
    const { configureDryRunMode, withStandardDecorators, makeTool, connect } = await setup();
    const tool = withStandardDecorators(makeTool("create-thing"));
    configureDryRunMode(true);

    const { client, close } = await connect([tool]);
    try {
      const result: any = await client.callTool({ name: "create-thing", arguments: { name: "x" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent.dryRun).toBe(true);
      expect(result.structuredContent.toolName).toBe("create-thing");
      expect(result.structuredContent.inputReceived).toEqual({ name: "x" });
    } finally {
      await close();
    }
  });

  it("returns the preview for a Forms-style stack without withStandardDecorators", async () => {
    const { configureDryRunMode, withDryRun, withPreExecutionCheck, withErrorHandling, compose, makeTool, connect } =
      await setup();
    const tool = withErrorHandling(compose(withDryRun, withPreExecutionCheck)(makeTool("create-form-body")));
    configureDryRunMode(true);

    const { client, close } = await connect([tool]);
    try {
      const result: any = await client.callTool({ name: "create-form-body", arguments: { name: "x" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent.dryRun).toBe(true);
    } finally {
      await close();
    }
  });

  it("omits outputSchema from tools/list for a mutation tool while dry-run is on", async () => {
    const { configureDryRunMode, withStandardDecorators, makeTool, connect } = await setup();
    const tool = withStandardDecorators(makeTool("create-thing"));
    configureDryRunMode(true);

    const { client, close } = await connect([tool]);
    try {
      const { tools } = await client.listTools();
      expect(tools.find((t) => t.name === "create-thing")!.outputSchema).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("keeps outputSchema and runs a read-only tool normally in dry-run", async () => {
    const { configureDryRunMode, withStandardDecorators, makeTool, connect } = await setup();
    const tool = withStandardDecorators(makeTool("get-thing", { readOnlyHint: true }));
    configureDryRunMode(true);

    const { client, close } = await connect([tool]);
    try {
      const { tools } = await client.listTools();
      expect(tools.find((t) => t.name === "get-thing")!.outputSchema).toBeDefined();
      const result: any = await client.callTool({ name: "get-thing", arguments: { name: "x" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ id: "real-id", message: "real" });
    } finally {
      await close();
    }
  });

  it("keeps outputSchema and validated output when dry-run is off", async () => {
    const { configureDryRunMode, withStandardDecorators, makeTool, connect } = await setup();
    const tool = withStandardDecorators(makeTool("create-thing"));
    configureDryRunMode(false);

    const { client, close } = await connect([tool]);
    try {
      const { tools } = await client.listTools();
      expect(tools.find((t) => t.name === "create-thing")!.outputSchema).toBeDefined();
      const result: any = await client.callTool({ name: "create-thing", arguments: { name: "x" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ id: "real-id", message: "real" });
    } finally {
      await close();
    }
  });

  it("keeps outputSchema for a tool no dry-run interception wrapped", async () => {
    const { configureDryRunMode, withErrorHandling, makeTool, connect } = await setup();
    const tool = withErrorHandling(makeTool("create-thing"));
    configureDryRunMode(true);

    const { client, close } = await connect([tool]);
    try {
      const { tools } = await client.listTools();
      expect(tools.find((t) => t.name === "create-thing")!.outputSchema).toBeDefined();
      const result: any = await client.callTool({ name: "create-thing", arguments: { name: "x" } });
      expect(result.structuredContent).toEqual({ id: "real-id", message: "real" });
    } finally {
      await close();
    }
  });
});
