/**
 * MCP Client Manager Integration Tests
 *
 * Tests the full MCP client lifecycle using the test echo server.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import path from "path";
import { fileURLToPath } from "url";
import { createMcpClientManager } from "../manager.js";

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
