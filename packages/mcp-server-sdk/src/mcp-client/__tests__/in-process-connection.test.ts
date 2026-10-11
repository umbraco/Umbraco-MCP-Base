/**
 * In-Process Connection Tests
 *
 * Tests the in-process MCP connection adapter.
 */

import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import { InProcessConnection } from "../in-process-connection.js";
import type { ToolCollectionExport } from "../../types/tool-collection.js";
import type { ToolDefinition } from "../../types/tool-definition.js";
import {
  UMBRACO_VERSION_CONTEXT_KEY,
  getUmbracoVersion,
  isAtLeast,
} from "../../umbraco-version/request-context.js";
import { TELEMETRY_CONTEXT_KEY } from "../../telemetry/request-context.js";
import { runWithRequestContext } from "../../request-context/async-request-context.js";

function createToolDef(
  overrides: Partial<ToolDefinition<any, any, any>> &
    Pick<ToolDefinition<any, any, any>, "name" | "description" | "slices" | "handler">,
): ToolDefinition<any, any, any> {
  return overrides as ToolDefinition<any, any, any>;
}

const echoCollection: ToolCollectionExport = {
  metadata: {
    name: "echo",
    displayName: "Echo Tools",
    description: "Simple echo tools for testing",
  },
  tools: () => [
    createToolDef({
      name: "echo",
      description: "Echoes a message back",
      inputSchema: { message: z.string() },
      slices: ["read"],
      handler: async (args: { message: string }) => ({
        content: [{ type: "text" as const, text: `Echo: ${args.message}` }],
      }),
    }),
    createToolDef({
      name: "add",
      description: "Adds two numbers",
      inputSchema: { a: z.number(), b: z.number() },
      slices: ["read"],
      handler: async (args: { a: number; b: number }) => ({
        content: [{ type: "text" as const, text: `Sum: ${args.a + args.b}` }],
      }),
    }),
  ],
};

const writeCollection: ToolCollectionExport = {
  metadata: {
    name: "write",
    displayName: "Write Tools",
    description: "Write tools for testing",
  },
  tools: () => [
    createToolDef({
      name: "save",
      description: "Saves data",
      inputSchema: { data: z.string() },
      slices: ["create"],
      handler: async (args: { data: string }) => ({
        content: [{ type: "text" as const, text: `Saved: ${args.data}` }],
      }),
    }),
  ],
};

describe("InProcessConnection", () => {
  it("should list tools from collections", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [echoCollection],
    });

    const { tools } = await connection.listTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toContain("echo");
    expect(tools.map((t) => t.name)).toContain("add");
  });

  it("should return JSON Schema for inputSchema", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [echoCollection],
    });

    const { tools } = await connection.listTools();
    const echoTool = tools.find((t) => t.name === "echo")!;

    expect(echoTool.inputSchema).toBeDefined();
    expect(echoTool.inputSchema!.type).toBe("object");
    expect(
      (echoTool.inputSchema!.properties as Record<string, unknown>)?.message,
    ).toBeDefined();
  });

  it("should call a tool and return results", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [echoCollection],
    });

    const result = await connection.callTool("echo", { message: "hello" });
    expect(result.content[0].text).toBe("Echo: hello");
  });

  it("should call add tool with numeric args", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [echoCollection],
    });

    const result = await connection.callTool("add", { a: 2, b: 3 });
    expect(result.content[0].text).toBe("Sum: 5");
  });

  it("should throw for unknown tool", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [echoCollection],
    });

    await expect(connection.callTool("unknown", {})).rejects.toThrow(
      "Tool not found: unknown",
    );
  });

  it("should list tools from multiple collections", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [echoCollection, writeCollection],
    });

    const { tools } = await connection.listTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toContain("save");
  });

  it("should filter tools by slice", async () => {
    const connection = new InProcessConnection(
      {
        transport: "in-process",
        name: "test",
        collections: [echoCollection, writeCollection],
      },
      { slices: ["read"] },
    );

    const { tools } = await connection.listTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).not.toContain("save");
  });

  it("should filter tools by collection", async () => {
    const connection = new InProcessConnection(
      {
        transport: "in-process",
        name: "test",
        collections: [echoCollection, writeCollection],
      },
      { toolCollections: ["write"] },
    );

    const { tools } = await connection.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("save");
  });

  it("should filter tools by tool name", async () => {
    const connection = new InProcessConnection(
      {
        transport: "in-process",
        name: "test",
        collections: [echoCollection],
      },
      { tools: ["echo"] },
    );

    const { tools } = await connection.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");
  });

  it("should pass user to collection.tools()", async () => {
    const userCollection: ToolCollectionExport = {
      metadata: {
        name: "user-tools",
        displayName: "User Tools",
        description: "Tools that depend on user context",
      },
      tools: (user: { role: string }) => {
        const tools: ToolDefinition<any, any, any>[] = [
          createToolDef({
            name: "read-data",
            description: "Read data",
            slices: ["read"],
            handler: async () => ({
              content: [{ type: "text" as const, text: "data" }],
            }),
          }),
        ];
        if (user?.role === "admin") {
          tools.push(
            createToolDef({
              name: "admin-action",
              description: "Admin only",
              slices: ["create"],
              handler: async () => ({
                content: [{ type: "text" as const, text: "admin" }],
              }),
            }),
          );
        }
        return tools;
      },
    };

    const adminConnection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [userCollection],
      user: { role: "admin" },
    });

    const { tools: adminTools } = await adminConnection.listTools();
    expect(adminTools).toHaveLength(2);

    const regularConnection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [userCollection],
      user: { role: "viewer" },
    });

    const { tools: regularTools } = await regularConnection.listTools();
    expect(regularTools).toHaveLength(1);
  });

  it("should close without error", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [echoCollection],
    });

    await expect(connection.close()).resolves.toBeUndefined();
  });
});

/**
 * A collection that lists `publish` only on 17.6+, and whose handlers report
 * the `extra` they received so tests can see exactly what crossed the chain.
 */
function createVersionedCollection(seenExtras: unknown[] = []): ToolCollectionExport {
  const reportExtra = async (_args: unknown, extra: unknown) => {
    seenExtras.push(extra);
    return { content: [{ type: "text" as const, text: getUmbracoVersion(extra) ?? "none" }] };
  };
  return {
    metadata: { name: "versioned", displayName: "Versioned", description: "" },
    tools: (_user, options) => {
      const tools: ToolDefinition<any, any, any>[] = [
        createToolDef({ name: "report", description: "Reports extra", slices: ["read"], handler: reportExtra }),
      ];
      if (isAtLeast(options?.umbracoVersion, 17, 6)) {
        tools.push(
          createToolDef({ name: "publish", description: "17.6+ only", slices: ["publish"], handler: reportExtra }),
        );
      }
      return tools;
    },
  };
}

const telemetry = Object.freeze({ tenant: "hash-a", region: "euwest01", loginSession: "login-a" });

describe("InProcessConnection request-scoped context", () => {
  it("builds the tool list from each call's version, with no cache between calls", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [createVersionedCollection()],
    });

    const newer = await connection.listTools({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.0" });
    const older = await connection.listTools({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.5.2" });
    const none = await connection.listTools();
    const newerAgain = await connection.listTools({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.0-rc.1" });

    expect(newer.tools.map((t) => t.name)).toEqual(["report", "publish"]);
    expect(older.tools.map((t) => t.name)).toEqual(["report"]);
    expect(none.tools.map((t) => t.name)).toEqual(["report"]);
    expect(newerAgain.tools.map((t) => t.name)).toEqual(["report", "publish"]);
  });

  it("calls collection.tools() afresh on every call", async () => {
    let calls = 0;
    const collection = createVersionedCollection();
    const counting: ToolCollectionExport = {
      ...collection,
      tools: (user, options) => {
        calls++;
        return collection.tools(user, options);
      },
    };
    const connection = new InProcessConnection({ transport: "in-process", name: "test", collections: [counting] });

    await connection.listTools();
    await connection.listTools();
    await connection.callTool("report", {});

    expect(calls).toBe(3);
  });

  it("rejects a version-gated tool when the caller's site is too old", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [createVersionedCollection()],
    });

    await expect(
      connection.callTool("publish", {}, { [UMBRACO_VERSION_CONTEXT_KEY]: "17.5.2" }),
    ).rejects.toThrow("Tool not found: publish");
    await expect(
      connection.callTool("publish", {}, { [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.0" }),
    ).resolves.toBeDefined();
  });

  it("carries version and telemetry from an explicit context, and nothing else", async () => {
    const seen: unknown[] = [];
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [createVersionedCollection(seen)],
    });
    const callerSignal = new AbortController().signal;

    await connection.callTool("publish", {}, {
      [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.1",
      [TELEMETRY_CONTEXT_KEY]: telemetry,
      signal: callerSignal,
      requestId: "outer-request",
      sessionId: "outer-session",
      authInfo: { token: "secret" },
    });

    const extra = seen[0] as Record<string, unknown>;
    expect(extra[UMBRACO_VERSION_CONTEXT_KEY]).toBe("17.6.1");
    expect(extra[TELEMETRY_CONTEXT_KEY]).toEqual(telemetry);
    expect(extra.signal).not.toBe(callerSignal);
    expect(extra.requestId).toBe("in-process");
    expect(extra).not.toHaveProperty("sessionId");
    expect(extra).not.toHaveProperty("authInfo");
  });

  it("falls back to the active request context store when no context is passed", async () => {
    const seen: unknown[] = [];
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [createVersionedCollection(seen)],
    });

    await runWithRequestContext(
      {
        [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.1",
        [TELEMETRY_CONTEXT_KEY]: telemetry,
        signal: new AbortController().signal,
        requestId: "outer-request",
      },
      () => connection.callTool("publish", {}),
    );

    const extra = seen[0] as Record<string, unknown>;
    expect(extra[UMBRACO_VERSION_CONTEXT_KEY]).toBe("17.6.1");
    expect(extra[TELEMETRY_CONTEXT_KEY]).toEqual(telemetry);
    expect(extra.requestId).toBe("in-process");
  });

  it("prefers an explicit context over the store", async () => {
    const seen: unknown[] = [];
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [createVersionedCollection(seen)],
    });

    await runWithRequestContext({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.1" }, () =>
      connection.callTool("report", {}, { [UMBRACO_VERSION_CONTEXT_KEY]: "17.5.0" }),
    );

    expect(getUmbracoVersion(seen[0])).toBe("17.5.0");
  });

  it("carries nothing outside a store with no explicit context", async () => {
    const seen: unknown[] = [];
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [createVersionedCollection(seen)],
    });

    await connection.callTool("report", {});

    const extra = seen[0] as Record<string, unknown>;
    expect(extra).not.toHaveProperty(UMBRACO_VERSION_CONTEXT_KEY);
    expect(extra).not.toHaveProperty(TELEMETRY_CONTEXT_KEY);
  });

  it("keeps interleaved store-scoped calls for different sites isolated", async () => {
    const seen: unknown[] = [];
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [createVersionedCollection(seen)],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const oldSite = runWithRequestContext({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.5.2" }, async () => {
      await gate;
      return connection.listTools();
    });
    const newSite = runWithRequestContext({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.0" }, async () => {
      const listed = await connection.listTools();
      release();
      return listed;
    });

    const [oldTools, newTools] = await Promise.all([oldSite, newSite]);
    expect(oldTools.tools.map((t) => t.name)).toEqual(["report"]);
    expect(newTools.tools.map((t) => t.name)).toEqual(["report", "publish"]);
  });
});

describe("ToolCollectionExport.tools options", () => {
  it("still accepts and runs a collection that declares only tools(user)", async () => {
    // Compile-time half: this assignment must type-check without an options param.
    const legacy: ToolCollectionExport<{ role: string }> = {
      metadata: { name: "legacy", displayName: "Legacy", description: "" },
      tools: (user: { role: string }) => [
        createToolDef({
          name: "whoami",
          description: "Returns the role",
          slices: ["read"],
          handler: async () => ({ content: [{ type: "text" as const, text: user.role }] }),
        }),
      ],
    };
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "test",
      collections: [legacy],
      user: { role: "editor" },
    });

    const { tools } = await connection.listTools({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.0" });
    const result = await connection.callTool("whoami", {}, { [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.0" });

    expect(tools.map((t) => t.name)).toEqual(["whoami"]);
    expect(result.content[0].text).toBe("editor");
  });
});
