import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { ToolCollectionExport } from "../../types/tool-collection.js";
import type { ToolDefinition } from "../../types/tool-definition.js";
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

  // @ts-expect-error - mock process.exit to throw instead of exiting
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
      cliFlags: { listTools: false, generateContext: false },
    });
    expect(exitCode).toBeUndefined();
  });

  it("handles --list-tools", () => {
    expect(() =>
      handleCliCommands(collections, {
        cliFlags: { listTools: true, generateContext: false },
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
        cliFlags: { listTools: false, describeTool: "get-item", generateContext: false },
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
        cliFlags: { listTools: false, describeTool: "nonexistent", generateContext: false },
      }),
    ).toThrow("process.exit(1)");

    expect(exitCode).toBe(1);
    expect(consoleErrorOutput).toContain("nonexistent");
    expect(consoleErrorOutput).toContain("--list-tools");
  });

  it("handles --generate-context", () => {
    expect(() =>
      handleCliCommands(collections, {
        cliFlags: { listTools: false, generateContext: true },
        serverName: "test-server",
        serverVersion: "1.2.3",
      }),
    ).toThrow("process.exit(0)");

    expect(exitCode).toBe(0);
    expect(consoleOutput).toContain("test-server");
    expect(consoleOutput).toContain("1.2.3");
    expect(consoleOutput).toContain("get-item");
  });
});
