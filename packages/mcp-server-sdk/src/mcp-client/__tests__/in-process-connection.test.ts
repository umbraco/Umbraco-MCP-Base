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
