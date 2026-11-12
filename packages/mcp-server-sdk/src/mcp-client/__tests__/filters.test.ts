/**
 * StdioConnection Filter Passthrough Tests
 *
 * Tests that filters are correctly passed through as CLI args to chained servers.
 */

import { describe, it, expect } from "@jest/globals";
import { StdioConnection } from "../stdio-connection.js";
import type { McpStdioServerConfig, FilterConfig } from "../types.js";

describe("StdioConnection Filter Passthrough", () => {
  // Helper to access private buildArgs method for testing
  function getBuildArgs(
    config: McpStdioServerConfig,
    filterConfig?: FilterConfig,
  ): string[] {
    const conn = new StdioConnection(config, filterConfig);
    return (conn as unknown as { buildArgs: () => string[] }).buildArgs();
  }

  it("should build args with tool filters", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: ["--base-arg"] },
      { tools: ["get-document", "list-documents"] },
    );

    expect(args).toContain("--base-arg");
    expect(args).toContain("--umbraco-include-tools");
    expect(args).toContain("get-document,list-documents");
  });

  it("should build args with slice filters", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { slices: ["read", "list"] },
    );

    expect(args).toContain("--umbraco-include-slices");
    expect(args).toContain("read,list");
  });

  it("should build args with mode filters", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { modes: ["content", "media"] },
    );

    expect(args).toContain("--umbraco-tool-modes");
    expect(args).toContain("content,media");
  });

  it("should build args with tool collection filters", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { toolCollections: ["document", "media-management"] },
    );

    expect(args).toContain("--umbraco-include-tool-collections");
    expect(args).toContain("document,media-management");
  });

  it("should build args with all filters combined", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: ["--base"] },
      {
        tools: ["get-document"],
        toolCollections: ["document"],
        slices: ["read"],
        modes: ["content"],
      },
    );

    expect(args).toContain("--base");
    expect(args).toContain("--umbraco-include-tools");
    expect(args).toContain("get-document");
    expect(args).toContain("--umbraco-include-tool-collections");
    expect(args).toContain("document");
    expect(args).toContain("--umbraco-include-slices");
    expect(args).toContain("read");
    expect(args).toContain("--umbraco-tool-modes");
    expect(args).toContain("content");
  });

  it("should build args with excluded slices", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { excludeSlices: ["delete", "update"] },
    );

    expect(args).toEqual(["--umbraco-exclude-slices", "delete,update"]);
  });

  it("should pass readonly mode as --umbraco-readonly", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: ["--base-arg"] },
      { readOnly: true },
    );

    expect(args).toEqual(["--base-arg", "--umbraco-readonly"]);
  });

  it("should not pass --umbraco-readonly when readonly is off", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { readOnly: false },
    );

    expect(args).toEqual([]);
  });

  it("should only use flags the SDK config accepts", async () => {
    // A chained server built on this SDK parses its command line with
    // CONFIG_FIELDS; a flag it does not define is silently ignored.
    const { CONFIG_FIELDS } = await import("../../config/config.js");
    const known = new Set(
      CONFIG_FIELDS.filter((f) => f.cliFlag).map((f) => `--${f.cliFlag}`),
    );

    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      {
        tools: ["a"],
        toolCollections: ["b"],
        slices: ["read"],
        excludeSlices: ["delete"],
        modes: ["c"],
        readOnly: true,
      },
    );

    const flags = args.filter((a) => a.startsWith("--"));
    expect(flags).toHaveLength(6);
    for (const flag of flags) {
      expect(known).toContain(flag);
    }
  });

  it("should not add filter args when no filters configured", () => {
    const args = getBuildArgs({
      name: "test",
      command: "test-cmd",
      args: ["--base-arg"],
    });

    expect(args).toEqual(["--base-arg"]);
    expect(args).not.toContain("--umbraco-include-tools");
    expect(args).not.toContain("--umbraco-include-slices");
    expect(args).not.toContain("--umbraco-tool-modes");
    expect(args).not.toContain("--umbraco-include-tool-collections");
  });

  it("should not add filter args for empty arrays", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { tools: [], slices: [] },
    );

    expect(args).toEqual([]);
    expect(args).not.toContain("--umbraco-include-tools");
    expect(args).not.toContain("--umbraco-include-slices");
  });

  it("should preserve base args order", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: ["-y", "@scope/package"] },
      { tools: ["tool1"] },
    );

    // Base args should come first
    expect(args[0]).toBe("-y");
    expect(args[1]).toBe("@scope/package");
    // Filter args come after
    expect(args.indexOf("--umbraco-include-tools")).toBeGreaterThan(1);
  });
});
