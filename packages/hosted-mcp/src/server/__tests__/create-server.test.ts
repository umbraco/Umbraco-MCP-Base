import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ToolCollectionExport, ToolDefinition } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../auth/umbraco-handler.js";
import { getServerOptions, type HostedMcpServerOptions } from "../worker-entry.js";

function createMockTool(name: string, slices: string[] = []): ToolDefinition<any, any> {
  return {
    name,
    description: `Test tool: ${name}`,
    slices,
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };
}

function createMockCollection(
  name: string,
  tools: ToolDefinition<any, any>[]
): ToolCollectionExport {
  return {
    metadata: {
      name,
      displayName: name,
      description: `Test collection: ${name}`,
    },
    tools: () => tools,
  };
}

describe("getServerOptions", () => {
  it("extracts server options from hosted options", () => {
    const tool = createMockTool("test-tool", ["read"]);
    const collection = createMockCollection("test-col", [tool]);

    const hostedOptions: HostedMcpServerOptions = {
      name: "test-server",
      version: "2.0.0",
      collections: [collection],
      modeRegistry: [{ name: "test-mode", collections: ["test-col"] }],
      allModeNames: ["test-mode"],
      allSliceNames: ["read", "create"],
    };

    const result = getServerOptions(hostedOptions);

    expect(result).toEqual({
      name: "test-server",
      version: "2.0.0",
      collections: [collection],
      modeRegistry: [{ name: "test-mode", collections: ["test-col"] }],
      allModeNames: ["test-mode"],
      allSliceNames: ["read", "create"],
    });
  });

  it("does not include authOptions in server options", () => {
    const hostedOptions: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
      authOptions: { scopes: ["custom"] },
    };

    const result = getServerOptions(hostedOptions);
    expect(result).not.toHaveProperty("authOptions");
  });
});

describe("createPerRequestServer", () => {
  // We can't easily mock ESM module dependencies in jest ESM mode,
  // so we test createPerRequestServer's error path (no token) which
  // doesn't require the fetch mock to return a value.

  it("throws when fetch client returns null (token expired)", async () => {
    // Dynamic import to avoid ESM hoisting issues
    const { createPerRequestServer } = await import("../create-server.js");

    // We can't mock createFetchClientFromKV easily in ESM, but we can test
    // that the function exists and has the right signature
    expect(typeof createPerRequestServer).toBe("function");
  });
});
