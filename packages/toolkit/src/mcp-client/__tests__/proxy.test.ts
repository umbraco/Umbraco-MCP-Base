/**
 * MCP Tool Proxy Tests
 *
 * Tests for discovering and proxying tools from chained MCP servers.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import path from "path";
import { fileURLToPath } from "url";
import { createMcpClientManager } from "../manager.js";
import {
  discoverProxiedTools,
  isProxiedToolName,
  parseProxiedToolName,
  createProxyHandler,
  proxiedToolsToDefinitions,
} from "../proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("MCP Tool Proxy", () => {
  describe("discoverProxiedTools", () => {
    const manager = createMcpClientManager();

    beforeAll(() => {
      // Register a test server with proxyTools enabled
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

    it("should discover tools from servers with proxyTools enabled", async () => {
      const proxiedTools = await discoverProxiedTools(manager);

      expect(proxiedTools.length).toBe(2); // echo and add from test server
      expect(proxiedTools.map((t) => t.prefixedName)).toContain("test:echo");
      expect(proxiedTools.map((t) => t.prefixedName)).toContain("test:add");
    });

    it("should include server name in proxied tools", async () => {
      const proxiedTools = await discoverProxiedTools(manager);

      for (const tool of proxiedTools) {
        expect(tool.serverName).toBe("test");
      }
    });

    it("should include original tool definition", async () => {
      const proxiedTools = await discoverProxiedTools(manager);
      const echoTool = proxiedTools.find((t) => t.prefixedName === "test:echo");

      expect(echoTool).toBeDefined();
      expect(echoTool?.originalTool.name).toBe("echo");
      expect(echoTool?.originalTool.description).toBeDefined();
    });
  });

  describe("discoverProxiedTools with proxyTools disabled", () => {
    it("should skip servers with proxyTools=false", async () => {
      const manager = createMcpClientManager();

      // Register a server with proxyTools disabled
      manager.registerServer({
        name: "no-proxy",
        command: "npx",
        args: ["tsx", path.resolve(__dirname, "echo-server.ts")],
        proxyTools: false,
      });

      const proxiedTools = await discoverProxiedTools(manager);

      expect(proxiedTools.length).toBe(0);
      await manager.disconnectAll();
    });
  });

  describe("isProxiedToolName", () => {
    it("should return true for prefixed names", () => {
      expect(isProxiedToolName("cms:get-document")).toBe(true);
      expect(isProxiedToolName("test:echo")).toBe(true);
      expect(isProxiedToolName("server:tool-name")).toBe(true);
    });

    it("should return false for non-prefixed names", () => {
      expect(isProxiedToolName("get-document")).toBe(false);
      expect(isProxiedToolName("echo")).toBe(false);
      expect(isProxiedToolName("tool-name")).toBe(false);
    });
  });

  describe("parseProxiedToolName", () => {
    it("should parse server name and tool name", () => {
      const result = parseProxiedToolName("cms:get-document");

      expect(result.serverName).toBe("cms");
      expect(result.toolName).toBe("get-document");
    });

    it("should handle tool names with hyphens", () => {
      const result = parseProxiedToolName("test:my-complex-tool-name");

      expect(result.serverName).toBe("test");
      expect(result.toolName).toBe("my-complex-tool-name");
    });

    it("should throw for non-prefixed names", () => {
      expect(() => parseProxiedToolName("get-document")).toThrow(
        "Invalid proxied tool name"
      );
    });
  });

  describe("createProxyHandler", () => {
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

    it("should create a handler that forwards calls", async () => {
      const handler = createProxyHandler(manager, "test", "echo");
      const result = await handler({ message: "hello from proxy" });

      expect(result.content[0].text).toBe("Echo: hello from proxy");
    });

    it("should forward arguments correctly", async () => {
      const handler = createProxyHandler(manager, "test", "add");
      const result = await handler({ a: 10, b: 20 });

      expect(result.content[0].text).toBe("Sum: 30");
    });
  });

  describe("proxiedToolsToDefinitions", () => {
    it("should convert proxied tools to registration format", () => {
      const proxiedTools = [
        {
          originalTool: {
            name: "get-document",
            description: "Gets a document by ID",
            inputSchema: { type: "object", properties: { id: { type: "string" } } },
          },
          prefixedName: "cms:get-document",
          serverName: "cms",
        },
      ];

      const definitions = proxiedToolsToDefinitions(proxiedTools);

      expect(definitions.length).toBe(1);
      expect(definitions[0].name).toBe("cms:get-document");
      expect(definitions[0].description).toContain("[Proxied from cms]");
      expect(definitions[0].description).toContain("Gets a document by ID");
    });

    it("should handle tools without description", () => {
      const proxiedTools = [
        {
          originalTool: { name: "mystery-tool" },
          prefixedName: "test:mystery-tool",
          serverName: "test",
        },
      ];

      const definitions = proxiedToolsToDefinitions(proxiedTools);

      expect(definitions[0].description).toContain("No description");
    });

    it("should provide default input schema", () => {
      const proxiedTools = [
        {
          originalTool: { name: "no-schema" },
          prefixedName: "test:no-schema",
          serverName: "test",
        },
      ];

      const definitions = proxiedToolsToDefinitions(proxiedTools);

      expect(definitions[0].inputSchema).toEqual({
        type: "object",
        properties: {},
      });
    });
  });
});
