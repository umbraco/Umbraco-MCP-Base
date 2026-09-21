/**
 * Decorator-stack tests for `withStandardDecorators`.
 *
 * Regression guard for umbraco/Umbraco-MCP-Base#127 + #133:
 * - `_meta` (e.g. `openai/fileParams`) must survive every wrapper.
 * - Nested-object input fields (host-injected payloads) must reach the handler
 *   structurally intact when the tool is wrapped via the standard stack.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { z } from "zod";
import { withStandardDecorators } from "../tool-decorators.js";

describe("withStandardDecorators", () => {
  it("preserves `_meta` declared on the tool definition", () => {
    const tool = {
      name: "t",
      description: "",
      inputSchema: { name: z.string() },
      handler: jest.fn().mockReturnValue({ content: [] }),
      slices: [],
      _meta: { "openai/fileParams": ["file"] },
    } as any;

    const decorated = withStandardDecorators(tool);
    expect(decorated._meta).toEqual({ "openai/fileParams": ["file"] });
  });

  it("delivers a host-injected nested-object field to the handler verbatim", async () => {
    const handler = jest.fn().mockReturnValue({ content: [] });
    const fileObjectSchema = z.object({
      download_url: z.string(),
      file_id: z.string(),
      mime_type: z.string().optional(),
      file_name: z.string().optional(),
    });
    const tool = {
      name: "create-media-from-file",
      description: "",
      inputSchema: {
        file: fileObjectSchema,
        name: z.string(),
        mediaTypeName: z.string(),
        parentId: z.string().uuid().optional(),
      },
      handler,
      slices: ["create"],
      _meta: { "openai/fileParams": ["file"] },
    } as any;

    const decorated = withStandardDecorators(tool);

    const fileObject = {
      download_url: "https://files.example.com/abc",
      file_id: "file-123",
      mime_type: "image/png",
      file_name: "photo.png",
    };
    await decorated.handler(
      {
        file: fileObject,
        name: "photo",
        mediaTypeName: "Image",
      } as any,
      {} as any,
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const received = (handler.mock.calls[0] as any[])[0] as { file: typeof fileObject };
    expect(received.file).toBe(fileObject);
    expect(received.file).toEqual(fileObject);
  });

  it("carries sessionId and the request-scoped telemetry carrier through the full chain for a tool with no inputSchema", async () => {
    // Regression guard: `withErrorHandling` is the outermost decorator, so
    // it's the one the MCP SDK calls directly. It used to hard-forward two
    // named params (`args, context`), which turned the SDK's one-argument
    // `(extra)` call — how it invokes any tool that declares no inputSchema,
    // e.g. `get-server-info` — into a two-argument `(extra, undefined)` call
    // for every decorator inside, silently dropping `context` and with it
    // `mcp.session.id` plus the tenant/region/login-session telemetry carrier.
    jest.resetModules();
    const telemetry = await import("../../telemetry/index.js");
    const { withStandardDecorators } = await import("../tool-decorators.js");

    const spans: Array<{ attributes: Record<string, unknown> }> = [];
    telemetry.setTelemetryAdapter({
      startSpan: async (_name, attributes, fn) => {
        const recorded = { attributes: { ...attributes } };
        spans.push(recorded);
        return fn({
          setAttribute(key, value) {
            recorded.attributes[key] = value;
          },
        });
      },
    });

    const tool = {
      name: "get-server-info",
      description: "",
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    } as any;

    const decorated = withStandardDecorators(tool);
    // Applied the same way a host applies it at registration time.
    const registered = telemetry.withRequestTelemetryContext(decorated.handler as any, {
      tenant: "hash-a",
      region: "euwest01",
      loginSession: "login-a",
    });

    // Exactly how the MCP SDK calls a tool that declares no inputSchema:
    // one argument, the request-handler `extra`.
    await (registered as any)({ sessionId: "sess-1" });

    expect(spans).toHaveLength(1);
    expect(spans[0].attributes["mcp.session.id"]).toBe("sess-1");
    expect(spans[0].attributes["umbraco.mcp.tenant"]).toBe("hash-a");
    expect(spans[0].attributes["umbraco.mcp.region"]).toBe("euwest01");
    expect(spans[0].attributes["umbraco.mcp.login_session"]).toBe("login-a");
  });
});
