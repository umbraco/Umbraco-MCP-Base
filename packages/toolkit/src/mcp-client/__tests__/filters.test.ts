/**
 * MCP Client Manager Filter Passthrough Tests
 *
 * Tests that filters are correctly passed through to chained servers.
 */

import { describe, it, expect } from "@jest/globals";
import { McpClientManager, createMcpClientManager } from "../manager.js";

describe("McpClientManager Filter Passthrough", () => {
  // Helper to access private buildArgs method for testing
  function getBuildArgs(manager: McpClientManager, serverName: string): string[] {
    const config = manager.getConfigs().get(serverName)!;
    // Access private method via any cast (test-only)
    return (manager as unknown as { buildArgs: (config: unknown) => string[] }).buildArgs(config);
  }

  it("should build args with tool filters", () => {
    const manager = createMcpClientManager({
      filterConfig: {
        tools: ["get-document", "list-documents"],
      },
    });

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: ["--base-arg"],
    });

    const args = getBuildArgs(manager, "test");

    expect(args).toContain("--base-arg");
    expect(args).toContain("--tools");
    expect(args).toContain("get-document,list-documents");
  });

  it("should build args with slice filters", () => {
    const manager = createMcpClientManager({
      filterConfig: {
        slices: ["read", "list"],
      },
    });

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: [],
    });

    const args = getBuildArgs(manager, "test");

    expect(args).toContain("--slices");
    expect(args).toContain("read,list");
  });

  it("should build args with mode filters", () => {
    const manager = createMcpClientManager({
      filterConfig: {
        modes: ["content", "media"],
      },
    });

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: [],
    });

    const args = getBuildArgs(manager, "test");

    expect(args).toContain("--modes");
    expect(args).toContain("content,media");
  });

  it("should build args with tool collection filters", () => {
    const manager = createMcpClientManager({
      filterConfig: {
        toolCollections: ["document", "media-management"],
      },
    });

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: [],
    });

    const args = getBuildArgs(manager, "test");

    expect(args).toContain("--tool-collections");
    expect(args).toContain("document,media-management");
  });

  it("should build args with all filters combined", () => {
    const manager = createMcpClientManager({
      filterConfig: {
        tools: ["get-document"],
        toolCollections: ["document"],
        slices: ["read"],
        modes: ["content"],
      },
    });

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: ["--base"],
    });

    const args = getBuildArgs(manager, "test");

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
    const manager = createMcpClientManager();

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: ["--base-arg"],
    });

    const args = getBuildArgs(manager, "test");

    expect(args).toEqual(["--base-arg"]);
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--slices");
    expect(args).not.toContain("--modes");
    expect(args).not.toContain("--tool-collections");
  });

  it("should not add filter args for empty arrays", () => {
    const manager = createMcpClientManager({
      filterConfig: {
        tools: [],
        slices: [],
      },
    });

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: [],
    });

    const args = getBuildArgs(manager, "test");

    expect(args).toEqual([]);
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--slices");
  });

  it("should preserve base args order", () => {
    const manager = createMcpClientManager({
      filterConfig: {
        tools: ["tool1"],
      },
    });

    manager.registerServer({
      name: "test",
      command: "test-cmd",
      args: ["-y", "@scope/package"],
    });

    const args = getBuildArgs(manager, "test");

    // Base args should come first
    expect(args[0]).toBe("-y");
    expect(args[1]).toBe("@scope/package");
    // Filter args come after
    expect(args.indexOf("--tools")).toBeGreaterThan(1);
  });
});
