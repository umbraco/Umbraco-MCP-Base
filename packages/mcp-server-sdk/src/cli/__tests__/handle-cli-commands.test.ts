import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
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

  it("returns normally when no CLI flags are set", () => {
    // Should not throw or exit
    handleCliCommands(collections, {
      cliFlags: { listTools: false, generateContext: false, debugConfig: false },
    });
    expect(exitCode).toBeUndefined();
  });

  it("handles --list-tools", () => {
    expect(() =>
      handleCliCommands(collections, {
        cliFlags: { listTools: true, generateContext: false, debugConfig: false },
      }),
    ).toThrow("process.exit(0)");

    expect(exitCode).toBe(0);
    expect(consoleOutput).toContain("get-item");
    expect(consoleOutput).toContain("delete-item");
    expect(consoleOutput).toContain("items");
  });

  it("handles --describe-tool for an existing tool", () => {
    expect(() =>
      handleCliCommands(collections, {
        cliFlags: { listTools: false, describeTool: "get-item", generateContext: false, debugConfig: false },
      }),
    ).toThrow("process.exit(0)");

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(consoleOutput.trim());
    expect(parsed.name).toBe("get-item");
    expect(parsed.collection).toBe("items");
    expect(parsed.slices).toEqual(["read"]);
  });

  it("handles --describe-tool for a missing tool", () => {
    expect(() =>
      handleCliCommands(collections, {
        cliFlags: { listTools: false, describeTool: "nonexistent", generateContext: false, debugConfig: false },
      }),
    ).toThrow("process.exit(1)");

    expect(exitCode).toBe(1);
    expect(consoleErrorOutput).toContain("nonexistent");
    expect(consoleErrorOutput).toContain("--list-tools");
  });

  it("handles --generate-context", () => {
    expect(() =>
      handleCliCommands(collections, {
        cliFlags: { listTools: false, generateContext: true, debugConfig: false },
        serverName: "test-server",
        serverVersion: "1.2.3",
      }),
    ).toThrow("process.exit(0)");

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

    it("--list-tools respects readOnly filter", () => {
      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: true, generateContext: false, debugConfig: false },
          filterConfig: readOnlyFilter,
        }),
      ).toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      expect(consoleOutput).toContain("get-item");
      expect(consoleOutput).not.toContain("delete-item");
    });

    it("--list-tools respects disabledTools filter", () => {
      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: true, generateContext: false, debugConfig: false },
          filterConfig: excludeToolFilter,
        }),
      ).toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      expect(consoleOutput).toContain("get-item");
      expect(consoleOutput).not.toContain("delete-item");
    });

    it("--describe-tool returns not found for filtered-out tool", () => {
      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: false, describeTool: "delete-item", generateContext: false, debugConfig: false },
          filterConfig: readOnlyFilter,
        }),
      ).toThrow("process.exit(1)");

      expect(exitCode).toBe(1);
      expect(consoleErrorOutput).toContain("delete-item");
    });

    it("--describe-tool still works for included tool", () => {
      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: false, describeTool: "get-item", generateContext: false, debugConfig: false },
          filterConfig: readOnlyFilter,
        }),
      ).toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.name).toBe("get-item");
    });

    it("--generate-context respects filter", () => {
      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: true, debugConfig: false },
          serverName: "test-server",
          serverVersion: "1.0.0",
          filterConfig: readOnlyFilter,
        }),
      ).toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      expect(consoleOutput).toContain("get-item");
      expect(consoleOutput).not.toContain("delete-item");
    });

    it("--generate-context skips empty collections", () => {
      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: true, debugConfig: false },
          serverName: "test-server",
          serverVersion: "1.0.0",
          filterConfig: includeCollectionFilter,
        }),
      ).toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      // Collection header should not appear since all tools are filtered out
      expect(consoleOutput).not.toContain("### items");
    });
  });

  describe("--debug-config", () => {
    it("prints resolved config as JSON and exits", () => {
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

      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: true },
          serverConfig: mockConfig as any,
          filterConfig: { ...DEFAULT_COLLECTION_CONFIG, readOnly: true },
        }),
      ).toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.auth.clientId.value).toBe("(set)");
      expect(parsed.auth.clientSecret.value).toBe("(set)");
      expect(parsed.auth.baseUrl.value).toBe("http://localhost");
      expect(parsed.filtering.readonly.value).toBe(true);
      expect(parsed.filtering.readonly.source).toBe("env");
      expect(parsed.resolvedFilterConfig.readOnly).toBe(true);
    });

    it("does not leak secrets in output", () => {
      const mockConfig = {
        auth: { clientId: "my-secret-id", clientSecret: "my-secret-password", baseUrl: "http://localhost" },
        configSources: {
          clientId: "env" as const,
          clientSecret: "env" as const,
          baseUrl: "env" as const,
          envFile: "default" as const,
        },
      };

      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: true },
          serverConfig: mockConfig as any,
        }),
      ).toThrow("process.exit(0)");

      expect(consoleOutput).not.toContain("my-secret-id");
      expect(consoleOutput).not.toContain("my-secret-password");
    });

    it("prints error when serverConfig not provided", () => {
      expect(() =>
        handleCliCommands(collections, {
          cliFlags: { listTools: false, generateContext: false, debugConfig: true },
        }),
      ).toThrow("process.exit(0)");

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(consoleOutput.trim());
      expect(parsed.error).toContain("serverConfig not passed");
    });
  });
});
