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
    expect(args).toContain("--tools");
    expect(args).toContain("get-document,list-documents");
  });

  it("should build args with slice filters", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { slices: ["read", "list"] },
    );

    expect(args).toContain("--slices");
    expect(args).toContain("read,list");
  });

  it("should build args with mode filters", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { modes: ["content", "media"] },
    );

    expect(args).toContain("--modes");
    expect(args).toContain("content,media");
  });

  it("should build args with tool collection filters", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { toolCollections: ["document", "media-management"] },
    );

    expect(args).toContain("--tool-collections");
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
    expect(args).toContain("--tools");
    expect(args).toContain("get-document");
    expect(args).toContain("--tool-collections");
    expect(args).toContain("document");
    expect(args).toContain("--slices");
    expect(args).toContain("read");
    expect(args).toContain("--modes");
    expect(args).toContain("content");
  });

  it("should not add filter args when no filters configured", () => {
    const args = getBuildArgs({
      name: "test",
      command: "test-cmd",
      args: ["--base-arg"],
    });

    expect(args).toEqual(["--base-arg"]);
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--slices");
    expect(args).not.toContain("--modes");
    expect(args).not.toContain("--tool-collections");
  });

  it("should not add filter args for empty arrays", () => {
    const args = getBuildArgs(
      { name: "test", command: "test-cmd", args: [] },
      { tools: [], slices: [] },
    );

    expect(args).toEqual([]);
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--slices");
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
    expect(args.indexOf("--tools")).toBeGreaterThan(1);
  });
});
