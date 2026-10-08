/**
 * MCP Client Manager Integration Tests
 *
 * Tests the full MCP client lifecycle using the test echo server.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import path from "path";
import { fileURLToPath } from "url";
import { createMcpClientManager } from "../manager.js";
import { extractChainedResult } from "../../helpers/chained-result.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("McpClientManager Integration", () => {
  const manager = createMcpClientManager();

  beforeAll(() => {
    manager.registerServer({
      name: "test",
      command: "npx",
      args: ["tsx", path.resolve(__dirname, "echo-server.ts")],
      proxyTools: true,
    });
  });

  afterAll(async () => {
    await manager.disconnectAll();
  });

  it("should connect to MCP server", async () => {
    const client = await manager.connect("test");
    expect(client).toBeDefined();
  });

  it("should reuse existing connection", async () => {
    const client1 = await manager.connect("test");
    const client2 = await manager.connect("test");
    expect(client1).toBe(client2);
  });

  it("should list tools from server", async () => {
    const { tools } = await manager.listTools("test");
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toContain("echo");
    expect(tools.map((t) => t.name)).toContain("add");
  });

  it("should call echo tool", async () => {
    const result = await manager.callTool("test", "echo", { message: "hello" });
    expect(result.content[0].text).toBe("Echo: hello");
  });

  it("should call add tool", async () => {
    const result = await manager.callTool("test", "add", { a: 2, b: 3 });
    expect(result.content[0].text).toBe("Sum: 5");
  });

  it("should throw for unknown server", async () => {
    await expect(manager.connect("unknown")).rejects.toThrow(
      "Unknown MCP server: unknown"
    );
  });

  it("should throw for unknown tool", async () => {
    await expect(manager.callTool("test", "unknown", {})).rejects.toThrow();
  });

  it("should report connected status", async () => {
    expect(manager.isConnected("test")).toBe(true);
    expect(manager.isConnected("unknown")).toBe(false);
  });

  it("should report registered servers", () => {
    expect(manager.hasServer("test")).toBe(true);
    expect(manager.hasServer("unknown")).toBe(false);
  });
});

describe("McpClientManager with a server on an older SDK", () => {
  // Regression tests for umbraco/Umbraco-MCP-Base#343: the v1.x Client's
  // callTool() validates structuredContent against the outputSchema it
  // cached from tools/list, even on isError results, and throws -32602.
  const manager = createMcpClientManager();

  beforeAll(async () => {
    manager.registerServer({
      name: "legacy",
      command: "npx",
      args: ["tsx", path.resolve(__dirname, "legacy-result-server.ts")],
    });
    // Listing first is what makes the v1.x Client cache output validators.
    await manager.listTools("legacy");
  });

  afterAll(async () => {
    await manager.disconnectAll();
  });

  it("returns the chained server's error instead of a schema mismatch", async () => {
    const result = await manager.callTool("legacy", "get-thing", { fail: true });

    expect(result.isError).toBe(true);
    expect(extractChainedResult(result)).toMatchObject({
      title: "Parent not found",
      status: 404,
      operationStatus: "ParentNotFound",
    });
  });

  it("returns a result carrying fields the closed outputSchema doesn't list", async () => {
    const result = await manager.callTool("legacy", "get-thing", {});

    expect(result.isError).toBeFalsy();
    expect(extractChainedResult(result)).toEqual({ alias: "a", visibleWhen: null });
  });
});
