/**
 * Regression tests for the version-check wiring seam.
 *
 * `check-umbraco-version.test.ts` only covers the `VersionCheckService`
 * state machine in isolation — it passed even while the feature was
 * completely unwired (umbraco/Umbraco-MCP-Base#201). These tests exercise
 * the actual seam: `checkUmbracoVersion` → `configureVersionCheckHook` →
 * `withStandardDecorators`/`withPreExecutionCheck`, i.e. what a real tool
 * call experiences.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { z } from "zod";
import {
  checkUmbracoVersion,
  configureVersionCheckHook,
  VersionCheckService,
  type VersionCheckClient,
} from "../check-umbraco-version.js";
import { withStandardDecorators } from "../../helpers/tool-decorators.js";
import type { ToolDefinition } from "../../types/tool-definition.js";

function makeTool(handler: (...args: any[]) => any) {
  const tool: ToolDefinition<any, any> = {
    name: "test-tool",
    description: "test tool",
    inputSchema: { name: z.string().optional() },
    slices: [],
    handler: handler as any,
  };
  return tool;
}

describe("configureVersionCheckHook", () => {
  it("blocks a wrapped tool after a mismatch, then clears after one use so a retry succeeds", async () => {
    // Use a private service instance so this test can't leak state into
    // (or be polluted by) other tests sharing the versionCheckService singleton.
    const service = new VersionCheckService();
    const client: VersionCheckClient = {
      getServerInformation: jest
        .fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "17.3.1" }),
    };

    await checkUmbracoVersion({ mcpVersion: "1.0.0", expectedUmbracoMajor: "18", client, service });
    configureVersionCheckHook(service);

    const handler = jest
      .fn<() => Promise<{ content: { type: "text"; text: string }[] }>>()
      .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const decorated = withStandardDecorators(makeTool(handler));

    // First call: blocked with the mismatch message, handler never runs.
    const blockedResult: any = await decorated.handler({}, {} as any);
    expect(blockedResult.isError).toBe(true);
    expect(blockedResult.content[0].text).toContain("⚠️ Version Mismatch");
    expect(blockedResult.content[0].text).toContain("Umbraco 17.x");
    expect(handler).not.toHaveBeenCalled();

    // clearAfterUse should have unblocked the service.
    expect(service.isBlocked()).toBe(false);

    // Second call (the user's deliberate retry): executes normally.
    const secondResult = await decorated.handler({}, {} as any);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(secondResult).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("stays silent when major versions match", async () => {
    const service = new VersionCheckService();
    const client: VersionCheckClient = {
      getServerInformation: jest
        .fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "18.1.0" }),
    };

    await checkUmbracoVersion({ mcpVersion: "1.0.0", expectedUmbracoMajor: "18", client, service });
    configureVersionCheckHook(service);

    const handler = jest
      .fn<() => Promise<{ content: { type: "text"; text: string }[] }>>()
      .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const decorated = withStandardDecorators(makeTool(handler));

    const result = await decorated.handler({}, {} as any);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("never blocks when the server-info call fails", async () => {
    const service = new VersionCheckService();
    const client: VersionCheckClient = {
      getServerInformation: jest
        .fn<() => Promise<{ version: string }>>()
        .mockRejectedValue(new Error("network down")),
    };

    await checkUmbracoVersion({ mcpVersion: "1.0.0", expectedUmbracoMajor: "18", client, service });
    configureVersionCheckHook(service);

    expect(service.isBlocked()).toBe(false);
    expect(service.getMessage()).toContain("Unable to verify");

    const handler = jest
      .fn<() => Promise<{ content: { type: "text"; text: string }[] }>>()
      .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const decorated = withStandardDecorators(makeTool(handler));

    const result = await decorated.handler({}, {} as any);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });
});
