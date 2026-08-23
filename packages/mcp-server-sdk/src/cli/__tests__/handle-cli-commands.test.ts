import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolCollectionExport } from "../../types/tool-collection.js";
import type { ToolDefinition } from "../../types/tool-definition.js";
import type { CollectionConfiguration } from "../../types/collection-configuration.js";
import { DEFAULT_COLLECTION_CONFIG } from "../../types/collection-configuration.js";
import { handleCliCommands } from "../handle-cli-commands.js";

// ============================================================================
// Test fixtures
// ============================================================================

function makeTool(overrides: Partial<ToolDefinition<any, any>> = {}): ToolDefinition<any, any> {
  return {
    name: "test-tool",
    description: "A test tool",
    slices: ["read"],
    annotations: { readOnlyHint: true },
    inputSchema: {},
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    ...overrides,
  };
}

function makeCollection(
  name: string,
  tools: ToolDefinition<any, any>[],
): ToolCollectionExport {
  return {
    metadata: { name, displayName: name, description: `${name} collection` },
    tools: () => tools,
  };
}

// ============================================================================
// Helpers for capturing process.exit and console output
// ============================================================================

let exitCode: number | undefined;
let consoleOutput: string;
let consoleErrorOutput: string;
let originalExit: typeof process.exit;
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  exitCode = undefined;
  consoleOutput = "";
  consoleErrorOutput = "";

  originalExit = process.exit;
  originalLog = console.log;
  originalError = console.error;

  // Mock process.exit to throw instead of exiting
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${exitCode})`);
  }) as typeof process.exit;

  console.log = ((...args: unknown[]) => {
    consoleOutput += args.map(String).join(" ") + "\n";
  }) as typeof console.log;

  console.error = ((...args: unknown[]) => {
    consoleErrorOutput += args.map(String).join(" ") + "\n";
  }) as typeof console.error;
});

afterEach(() => {
  process.exit = originalExit;
  console.log = originalLog;
  console.error = originalError;
});

// ============================================================================
// Tests
// ============================================================================

describe("handleCliCommands", () => {
  const tool1 = makeTool({ name: "get-item", description: "Gets an item", slices: ["read"] });
  const tool2 = makeTool({ name: "delete-item", description: "Deletes an item", slices: ["delete"], annotations: { destructiveHint: true } });
  const collections = [
    makeCollection("items", [tool1, tool2]),
  ];

  it("returns normally when no CLI flags are set", async () => {
    // Should not throw or exit
    handleCliCommands(collections, {
      cliFlags: { listTools: false, generateContext: false, debugConfig: false },
    });
    expect(exitCode).toBeUndefined();
  });

  it("handles --list-tools", async () => {
    await expect(
      handleCliCommands(collections, {
        cliFlags: { listTools: true, generateContext: false, debugConfig: false },
      }),
    ).rejects.toThrow("process.exit(0)");

    expect(exitCode).toBe(0);
    expect(consoleOutput).toContain("get-item");
    expect(consoleOutput).toContain("delete-item");
    expect(consoleOutput).toContain("items");
  });

  it("handles --describe-tool for an existing tool", async () => {
    await expect(
      handleCliCommands(collections, {
        cliFlags: { listTools: false, describeTool: "get-item", generateContext: false, debugConfig: false },
      }),
    ).rejects.toThrow("process.exit(0)");

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(consoleOutput.trim());
    expect(parsed.name).toBe("get-item");
    expect(parsed.collection).toBe("items");
    expect(parsed.slices).toEqual(["read"]);
  });

  it("handles --describe-tool for a missing tool", async () => {
    await expect(
      handleCliCommands(collections, {
        cliFlags: { listTools: false, describeTool: "nonexistent", generateContext: false, debugConfig: false },
      }),
    ).rejects.toThrow("process.exit(1)");

    expect(exitCode).toBe(1);
    expect(consoleErrorOutput).toContain("nonexistent");
    expect(consoleErrorOutput).toContain("--list-tools");
  });

  it("handles --generate-context", async () => {
    await expect(
      handleCliCommands(collections, {
        cliFlags: { listTools: false, generateContext: true, debugConfig: false },
        serverName: "test-server",
        serverVersion: "1.2.3",
      }),
    ).rejects.toThrow("process.exit(0)");

    expect(exitCode).toBe(0);
    expect(consoleOutput).toContain("test-server");
    expect(consoleOutput).toContain("1.2.3");
    expect(consoleOutput).toContain("get-item");
  });

  describe("with filterConfig", () => {
    const readOnlyFilter: CollectionConfiguration = {
      ...DEFAULT_COLLECTION_CONFIG,
      readOnly: true,
    };

    const excludeToolFilter: CollectionConfiguration = {
      ...DEFAULT_COLLECTION_CONFIG,
      disabledTools: ["delete-item"],
    };

    const includeCollectionFilter: CollectionConfiguration = {
      ...DEFAULT_COLLECTION_CONFIG,
      enabledCollections: ["nonexistent"],
    };

    it("--list-tools respects readOnly filter", async () => {
      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: true, generateContext: false, debugConfig: false },
          filterConfig: readOnlyFilter,
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      expect(consoleOutput).toContain("get-item");
      expect(consoleOutput).not.toContain("delete-item");
    });

    it("--list-tools respects disabledTools filter", async () => {
      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: true, generateContext: false, debugConfig: false },
          filterConfig: excludeToolFilter,
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      expect(consoleOutput).toContain("get-item");
      expect(consoleOutput).not.toContain("delete-item");
    });

    it("--describe-tool returns not found for filtered-out tool", async () => {
      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: false, describeTool: "delete-item", generateContext: false, debugConfig: false },
          filterConfig: readOnlyFilter,
        }),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("delete-item");
    });

    it("--describe-tool still works for included tool", async () => {
      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: false, describeTool: "get-item", generateContext: false, debugConfig: false },
          filterConfig: readOnlyFilter,
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.name).toBe("get-item");
    });

    it("--generate-context respects filter", async () => {
      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: true, debugConfig: false },
          serverName: "test-server",
          serverVersion: "1.0.0",
          filterConfig: readOnlyFilter,
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      expect(consoleOutput).toContain("get-item");
      expect(consoleOutput).not.toContain("delete-item");
    });

    it("--generate-context skips empty collections", async () => {
      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: true, debugConfig: false },
          serverName: "test-server",
          serverVersion: "1.0.0",
          filterConfig: includeCollectionFilter,
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      // Collection header should not appear since all tools are filtered out
      expect(consoleOutput).not.toContain("### items");
    });
  });

  describe("--debug-config", () => {
    it("prints resolved config as JSON and exits", async () => {
      const mockConfig = {
        auth: { clientId: "test-id", clientSecret: "test-secret", baseUrl: "http://localhost" },
        readonly: true,
        configSources: {
          clientId: "env" as const,
          clientSecret: "cli" as const,
          baseUrl: "env" as const,
          readonly: "env" as const,
          envFile: "default" as const,
        },
      };

      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: true },
          serverConfig: mockConfig as any,
          filterConfig: { ...DEFAULT_COLLECTION_CONFIG, readOnly: true },
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.auth.clientId.value).toBe("(set)");
      expect(parsed.auth.clientSecret.value).toBe("(set)");
      expect(parsed.auth.baseUrl.value).toBe("http://localhost");
      expect(parsed.filtering.readonly.value).toBe(true);
      expect(parsed.filtering.readonly.source).toBe("env");
      expect(parsed.resolvedFilterConfig.readOnly).toBe(true);
    });

    it("does not leak secrets in output", async () => {
      const mockConfig = {
        auth: { clientId: "my-secret-id", clientSecret: "my-secret-password", baseUrl: "http://localhost" },
        configSources: {
          clientId: "env" as const,
          clientSecret: "env" as const,
          baseUrl: "env" as const,
          envFile: "default" as const,
        },
      };

      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: true },
          serverConfig: mockConfig as any,
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(consoleOutput).not.toContain("my-secret-id");
      expect(consoleOutput).not.toContain("my-secret-password");
    });

    it("prints error when serverConfig not provided", async () => {
      await expect(
      handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: true },
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.error).toContain("serverConfig not passed");
    });
  });

  describe("--call", () => {
    it("calls a tool and prints JSON result", async () => {
      const callableTool = makeTool({
        name: "get-item",
        handler: async (args: any) => ({
          content: [{ type: "text" as const, text: JSON.stringify({ id: args.id, name: "Test" }) }],
        }),
      });
      const cols = [makeCollection("items", [callableTool])];

      await expect(
        handleCliCommands(cols, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "get-item", callToolArgs: '{"id":"abc"}' },
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.id).toBe("abc");
      expect(parsed.name).toBe("Test");
    });

    it("prints structuredContent when available", async () => {
      const callableTool = makeTool({
        name: "get-item",
        handler: async () => ({
          content: [],
          structuredContent: { total: 3, items: ["a", "b", "c"] },
        }),
      });
      const cols = [makeCollection("items", [callableTool])];

      await expect(
        handleCliCommands(cols, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "get-item" },
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.total).toBe(3);
      expect(parsed.items).toEqual(["a", "b", "c"]);
    });

    it("exits 1 for nonexistent tool", async () => {
      await expect(
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "nonexistent" },
        }),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("nonexistent");
      expect(consoleErrorOutput).toContain("--list-tools");
    });

    it("exits 1 for invalid JSON args", async () => {
      await expect(
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "get-item", callToolArgs: "not-json" },
        }),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("Invalid JSON");
    });

    it("exits 1 when tool handler throws", async () => {
      const failingTool = makeTool({
        name: "fail-tool",
        handler: async () => { throw new Error("API timeout"); },
      });
      const cols = [makeCollection("items", [failingTool])];

      await expect(
        handleCliCommands(cols, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "fail-tool" },
        }),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("API timeout");
    });

    it("defaults to empty args when --call-args not provided", async () => {
      let receivedArgs: any;
      const callableTool = makeTool({
        name: "list-items",
        handler: async (args: any) => {
          receivedArgs = args;
          return { content: [{ type: "text" as const, text: "{}" }] };
        },
      });
      const cols = [makeCollection("items", [callableTool])];

      await expect(
        handleCliCommands(cols, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "list-items" },
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(receivedArgs).toEqual({});
    });
  });

  describe("--call-args-file", () => {
    const writtenFiles: string[] = [];

    function writeTempJsonFile(contents: string): string {
      const filePath = join(tmpdir(), `call-args-file-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(filePath, contents, "utf-8");
      writtenFiles.push(filePath);
      return filePath;
    }

    afterEach(() => {
      while (writtenFiles.length > 0) {
        const filePath = writtenFiles.pop();
        if (filePath) {
          try {
            unlinkSync(filePath);
          } catch {
            // ignore cleanup errors
          }
        }
      }
    });

    it("reads args from a file", async () => {
      let receivedArgs: any;
      const callableTool = makeTool({
        name: "get-item",
        handler: async (args: any) => {
          receivedArgs = args;
          return { content: [{ type: "text" as const, text: JSON.stringify({ id: args.id, name: "Test" }) }] };
        },
      });
      const cols = [makeCollection("items", [callableTool])];
      const filePath = writeTempJsonFile(JSON.stringify({ id: "from-file" }));

      await expect(
        handleCliCommands(cols, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "get-item", callToolArgsFile: filePath },
        }),
      ).rejects.toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      expect(receivedArgs).toEqual({ id: "from-file" });
    });

    it("exits 1 when both --call-args and --call-args-file are given", async () => {
      const filePath = writeTempJsonFile(JSON.stringify({ id: "from-file" }));

      await expect(
        handleCliCommands(collections, {
          cliFlags: {
            listTools: false,
            generateContext: false,
            debugConfig: false,
            callTool: "get-item",
            callToolArgs: '{"id":"abc"}',
            callToolArgsFile: filePath,
          },
        }),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("--call-args");
      expect(consoleErrorOutput).toContain("--call-args-file");
    });

    it("exits 1 when the file does not exist", async () => {
      const missingPath = join(tmpdir(), `call-args-file-test-missing-${Date.now()}.json`);

      await expect(
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "get-item", callToolArgsFile: missingPath },
        }),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("--call-args-file");
      expect(consoleErrorOutput).toContain(missingPath);
    });

    it("exits 1 when the file contains invalid JSON", async () => {
      const filePath = writeTempJsonFile("not-json");

      await expect(
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: false, callTool: "get-item", callToolArgsFile: filePath },
        }),
      ).rejects.toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("Invalid JSON");
      expect(consoleErrorOutput).toContain("--call-args-file");
    });
  });
});

