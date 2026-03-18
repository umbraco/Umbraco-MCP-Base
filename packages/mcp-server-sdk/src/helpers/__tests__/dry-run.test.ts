/**
 * Dry-Run Tests
 *
 * Tests for the dry-run mode that intercepts mutation tools.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Use dynamic imports to get fresh module state
async function getDryRunModule() {
  jest.resetModules();
  return await import("../dry-run.js");
}

describe("configureDryRunMode", () => {
  it("should default to disabled", async () => {
    const { isDryRunEnabled } = await getDryRunModule();
    expect(isDryRunEnabled()).toBe(false);
  });

  it("should enable dry-run mode", async () => {
    const { configureDryRunMode, isDryRunEnabled } = await getDryRunModule();
    configureDryRunMode(true);
    expect(isDryRunEnabled()).toBe(true);
  });

  it("should disable dry-run mode", async () => {
    const { configureDryRunMode, isDryRunEnabled } = await getDryRunModule();
    configureDryRunMode(true);
    configureDryRunMode(false);
    expect(isDryRunEnabled()).toBe(false);
  });
});

describe("withDryRun", () => {
  it("should execute handler normally when dry-run is disabled", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(false);

    const handler = jest.fn().mockReturnValue({ content: [{ type: "text", text: "done" }] });
    const tool = {
      name: "test-mutation",
      description: "test",
      handler,
      slices: ["create"],
      annotations: { destructiveHint: true },
    } as any;

    const wrapped = withDryRun(tool);
    await wrapped.handler({ input: "test" } as any, {} as any);
    expect(handler).toHaveBeenCalled();
  });

  it("should execute read-only tools normally in dry-run mode", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn().mockReturnValue({ content: [{ type: "text", text: "data" }] });
    const tool = {
      name: "test-read",
      description: "test",
      handler,
      slices: ["read"],
      annotations: { readOnlyHint: true },
    } as any;

    const wrapped = withDryRun(tool);
    await wrapped.handler({} as any, {} as any);
    expect(handler).toHaveBeenCalled();
  });

  it("should intercept mutation tools in dry-run mode", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn();
    const tool = {
      name: "test-delete",
      description: "delete something",
      handler,
      slices: ["delete"],
      annotations: { destructiveHint: true },
    } as any;

    const wrapped = withDryRun(tool);
    const result = await wrapped.handler({ id: "123" } as any, {} as any);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeDefined();

    // Check the structured content
    const structured = (result as any).structuredContent;
    expect(structured.dryRun).toBe(true);
    expect(structured.toolName).toBe("test-delete");
    expect(structured.wouldExecute).toBe(true);
    expect(structured.inputReceived).toEqual({ id: "123" });
  });

  it("should intercept tools without readOnlyHint in dry-run mode", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn();
    const tool = {
      name: "test-update",
      description: "update something",
      handler,
      slices: ["update"],
      // No annotations — default is not read-only
    } as any;

    const wrapped = withDryRun(tool);
    const result = await wrapped.handler({ data: "new" } as any, {} as any);

    expect(handler).not.toHaveBeenCalled();
    expect((result as any).structuredContent.dryRun).toBe(true);
  });

  it("should include annotation info in dry-run response", async () => {
    const { withDryRun, configureDryRunMode } = await getDryRunModule();
    configureDryRunMode(true);

    const handler = jest.fn();
    const tool = {
      name: "test-tool",
      description: "test",
      handler,
      slices: [],
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    } as any;

    const wrapped = withDryRun(tool);
    const result = await wrapped.handler({} as any, {} as any);

    const annotations = (result as any).structuredContent.annotations;
    expect(annotations.destructiveHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.readOnlyHint).toBe(false);
  });
});
