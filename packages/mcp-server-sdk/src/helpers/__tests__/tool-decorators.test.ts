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
});
