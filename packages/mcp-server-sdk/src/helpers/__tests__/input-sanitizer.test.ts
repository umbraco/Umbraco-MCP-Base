/**
 * Input Sanitizer Tests
 *
 * Tests for input validation functions that protect against agent hallucinations.
 */

import { jest, describe, it, expect } from "@jest/globals";
import { z } from "zod";
import {
  rejectControlCharacters,
  rejectPathTraversal,
  rejectEmbeddedQueryParams,
  rejectPreEncodedStrings,
  sanitizeStringInput,
  validateUUID,
  withInputSanitization,
  RAW_FIELD_MARKER,
} from "../input-sanitizer.js";
import { ToolValidationError } from "../tool-validation-error.js";

describe("rejectControlCharacters", () => {
  it("should accept normal text", () => {
    expect(() => rejectControlCharacters("hello world", "field")).not.toThrow();
  });

  it("should accept tabs, newlines, and carriage returns", () => {
    expect(() => rejectControlCharacters("line1\nline2", "field")).not.toThrow();
    expect(() => rejectControlCharacters("col1\tcol2", "field")).not.toThrow();
    expect(() => rejectControlCharacters("line1\r\nline2", "field")).not.toThrow();
  });

  it("should reject null bytes", () => {
    expect(() => rejectControlCharacters("hello\x00world", "field")).toThrow(ToolValidationError);
  });

  it("should reject other control characters", () => {
    expect(() => rejectControlCharacters("hello\x01world", "field")).toThrow(ToolValidationError);
    expect(() => rejectControlCharacters("hello\x1Fworld", "field")).toThrow(ToolValidationError);
    expect(() => rejectControlCharacters("hello\x0Bworld", "field")).toThrow(ToolValidationError);
  });

  it("should include field name in error", () => {
    try {
      rejectControlCharacters("bad\x00input", "myField");
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ToolValidationError);
      expect((error as ToolValidationError).message).toContain("myField");
    }
  });
});

describe("rejectPathTraversal", () => {
  it("should accept normal identifiers", () => {
    expect(() => rejectPathTraversal("my-document", "field")).not.toThrow();
    expect(() => rejectPathTraversal("550e8400-e29b-41d4-a716-446655440000", "field")).not.toThrow();
  });

  it("should reject ../ sequences", () => {
    expect(() => rejectPathTraversal("../etc/passwd", "field")).toThrow(ToolValidationError);
    expect(() => rejectPathTraversal("foo/../bar", "field")).toThrow(ToolValidationError);
  });

  it("should reject ..\\ sequences", () => {
    expect(() => rejectPathTraversal("..\\windows\\system32", "field")).toThrow(ToolValidationError);
  });

  it("should allow POSIX absolute paths", () => {
    // Umbraco uses /-prefixed paths as identifiers for stylesheets, scripts, etc.
    expect(() => rejectPathTraversal("/stylesheet.css", "field")).not.toThrow();
    expect(() => rejectPathTraversal("/scripts/app.js", "field")).not.toThrow();
    expect(() => rejectPathTraversal("/Views/Partials/header.cshtml", "field")).not.toThrow();
    // Filesystem paths are not traversal — allowlist policy is the consumer's job.
    expect(() => rejectPathTraversal("/Users/me/photo.png", "field")).not.toThrow();
    expect(() => rejectPathTraversal("/tmp/upload.jpg", "field")).not.toThrow();
  });

  it("should allow Windows absolute paths (drive-rooted and UNC)", () => {
    // Absolute paths aren't traversal — allowlist policy belongs to the consumer.
    // See https://github.com/umbraco/Umbraco-MCP-Base/issues/86
    expect(() => rejectPathTraversal("C:\\Windows\\image.png", "field")).not.toThrow();
    expect(() => rejectPathTraversal("D:\\some\\folder\\image.webp", "field")).not.toThrow();
    expect(() => rejectPathTraversal("c:/users/me/file.txt", "field")).not.toThrow();
    expect(() => rejectPathTraversal("\\\\server\\share\\file.txt", "field")).not.toThrow();
  });

  it("should reject traversal sequences inside otherwise-absolute paths", () => {
    expect(() => rejectPathTraversal("C:\\Windows\\..\\Users", "field")).toThrow(ToolValidationError);
    expect(() => rejectPathTraversal("/Users/me/../../etc/passwd", "field")).toThrow(ToolValidationError);
  });
});

describe("rejectEmbeddedQueryParams", () => {
  it("should accept clean identifiers", () => {
    expect(() => rejectEmbeddedQueryParams("my-doc-id", "field")).not.toThrow();
  });

  it("should reject ? characters", () => {
    expect(() => rejectEmbeddedQueryParams("id?skip=0", "field")).toThrow(ToolValidationError);
  });

  it("should reject & characters", () => {
    expect(() => rejectEmbeddedQueryParams("id&take=10", "field")).toThrow(ToolValidationError);
  });
});

describe("rejectPreEncodedStrings", () => {
  it("should accept normal text", () => {
    expect(() => rejectPreEncodedStrings("hello world", "field")).not.toThrow();
  });

  it("should reject percent-encoded sequences", () => {
    expect(() => rejectPreEncodedStrings("hello%20world", "field")).toThrow(ToolValidationError);
    expect(() => rejectPreEncodedStrings("path%2Fto%2Fthing", "field")).toThrow(ToolValidationError);
  });

  it("should not reject percent signs that aren't encoding", () => {
    expect(() => rejectPreEncodedStrings("50% off", "field")).not.toThrow();
  });
});

describe("validateUUID", () => {
  it("should accept valid UUIDs", () => {
    expect(() => validateUUID("550e8400-e29b-41d4-a716-446655440000", "field")).not.toThrow();
    expect(() => validateUUID("00000000-0000-0000-0000-000000000000", "field")).not.toThrow();
  });

  it("should reject invalid UUIDs", () => {
    expect(() => validateUUID("not-a-uuid", "field")).toThrow(ToolValidationError);
    expect(() => validateUUID("550e8400-e29b-41d4-a716", "field")).toThrow(ToolValidationError);
    expect(() => validateUUID("", "field")).toThrow(ToolValidationError);
  });

  it("should include the received value in error", () => {
    try {
      validateUUID("bad-uuid", "id");
      expect(true).toBe(false);
    } catch (error) {
      expect((error as ToolValidationError).message).toContain("bad-uuid");
    }
  });
});

describe("sanitizeStringInput", () => {
  it("should pass clean strings", () => {
    expect(() => sanitizeStringInput("clean-value", "field")).not.toThrow();
  });

  it("should reject all bad patterns by default", () => {
    expect(() => sanitizeStringInput("val\x00ue", "field")).toThrow();
    expect(() => sanitizeStringInput("../path", "field")).toThrow();
    expect(() => sanitizeStringInput("id?q=1", "field")).toThrow();
    expect(() => sanitizeStringInput("val%20ue", "field")).toThrow();
  });

  it("should allow opting out of specific checks", () => {
    expect(() => sanitizeStringInput("id?q=1", "field", { allowQueryParams: true })).not.toThrow();
    expect(() => sanitizeStringInput("val%20ue", "field", { allowPreEncoded: true })).not.toThrow();
    expect(() => sanitizeStringInput("../path", "field", { allowPathTraversal: true })).not.toThrow();
    expect(() => sanitizeStringInput("val\x00ue", "field", { allowControlCharacters: true })).not.toThrow();
  });
});

describe("withInputSanitization", () => {
  it("should sanitize string inputs before calling handler", () => {
    const handler = jest.fn().mockReturnValue({ content: [] });
    const tool = {
      name: "test-tool",
      description: "test",
      inputSchema: {
        name: { _def: { typeName: "ZodString" } },
      },
      handler,
      slices: [],
    } as any;

    const sanitized = withInputSanitization(tool);

    expect(() =>
      sanitized.handler({ name: "val\x00ue" } as any, {} as any)
    ).toThrow(ToolValidationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("should pass through valid inputs", () => {
    const handler = jest.fn().mockReturnValue({ content: [] });
    const tool = {
      name: "test-tool",
      description: "test",
      inputSchema: {
        name: { _def: { typeName: "ZodString" } },
      },
      handler,
      slices: [],
    } as any;

    const sanitized = withInputSanitization(tool);
    sanitized.handler({ name: "valid-input" } as any, {} as any);
    expect(handler).toHaveBeenCalled();
  });

  it("should skip non-string values", () => {
    const handler = jest.fn().mockReturnValue({ content: [] });
    const tool = {
      name: "test-tool",
      description: "test",
      inputSchema: {
        count: { _def: { typeName: "ZodNumber" } },
      },
      handler,
      slices: [],
    } as any;

    const sanitized = withInputSanitization(tool);
    sanitized.handler({ count: 42 } as any, {} as any);
    expect(handler).toHaveBeenCalled();
  });

  it("should skip fields marked with [raw]", () => {
    const handler = jest.fn().mockReturnValue({ content: [] });
    const tool = {
      name: "test-tool",
      description: "test",
      inputSchema: {
        body: { description: `HTML content ${RAW_FIELD_MARKER}` },
      },
      handler,
      slices: [],
    } as any;

    const sanitized = withInputSanitization(tool);
    // This contains path traversal but should pass because of [raw]
    sanitized.handler({ body: "../some/path" } as any, {} as any);
    expect(handler).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Nested-object handling (issue umbraco/Umbraco-MCP-Base#133)
  //
  // Hosts like ChatGPT inject structured payloads via `_meta.openai/fileParams`
  // — the handler MUST receive the object exactly as the host sent it. The
  // sanitiser is allowed to walk INTO the object to reject bad string content
  // at any depth, but is not allowed to reshape, reorder, or substitute it.
  // ---------------------------------------------------------------------------
  describe("nested object handling", () => {
    it("passes a nested object through to the handler structurally intact", () => {
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        file: z.object({
          download_url: z.string(),
          file_id: z.string(),
          mime_type: z.string().optional(),
          file_name: z.string().optional(),
        }),
        name: z.string(),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      const fileObject = {
        download_url: "https://files.example.com/abc",
        file_id: "file-123",
        mime_type: "image/png",
        file_name: "photo.png",
      };
      sanitized.handler({ file: fileObject, name: "clean-name" } as any, {} as any);

      expect(handler).toHaveBeenCalledTimes(1);
      const receivedArgs = (handler.mock.calls[0] as any[])[0] as { file: typeof fileObject; name: string };
      expect(receivedArgs.file).toBe(fileObject);
      expect(receivedArgs.file).toEqual(fileObject);
      expect(receivedArgs.name).toBe("clean-name");
    });

    it("passes an array of nested objects through structurally intact", () => {
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        files: z.array(
          z.object({
            download_url: z.string(),
            file_id: z.string(),
          })
        ),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      const filesArray = [
        { download_url: "https://files.example.com/a", file_id: "file-a" },
        { download_url: "https://files.example.com/b", file_id: "file-b" },
      ];
      sanitized.handler({ files: filesArray } as any, {} as any);

      expect(handler).toHaveBeenCalledTimes(1);
      const receivedArgs = (handler.mock.calls[0] as any[])[0] as { files: typeof filesArray };
      expect(receivedArgs.files).toBe(filesArray);
      expect(receivedArgs.files).toEqual(filesArray);
    });

    it("still rejects bad string content on top-level siblings of a nested object", () => {
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        file: z.object({ download_url: z.string() }),
        name: z.string(),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      expect(() =>
        sanitized.handler(
          {
            file: { download_url: "https://files.example.com/abc" },
            name: "bad\x00name",
          } as any,
          {} as any,
        ),
      ).toThrow(ToolValidationError);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects bad string content inside a nested object (closes a silent hole)", () => {
      // The old top-level-only walker silently let through control characters
      // in nested fields. Recursive sanitisation should catch them.
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        meta: z.object({ note: z.string() }),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      expect(() =>
        sanitized.handler({ meta: { note: "bad\x00note" } } as any, {} as any),
      ).toThrow(ToolValidationError);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects bad strings inside array element objects", () => {
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        items: z.array(z.object({ name: z.string() })),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      expect(() =>
        sanitized.handler(
          { items: [{ name: "ok" }, { name: "../bad" }] } as any,
          {} as any,
        ),
      ).toThrow(ToolValidationError);
      expect(handler).not.toHaveBeenCalled();
    });

    it("honors [raw] on an object schema — whole subtree passes through unsanitised", () => {
      // Host-injected payloads (openai/fileParams) carry data we don't own. A
      // `[raw]` marker on the object opts the whole subtree out of sanitisation,
      // even if its string leaves contain characters the agent-input rules
      // would otherwise reject.
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        file: z
          .object({
            download_url: z.string(),
            file_id: z.string(),
          })
          .describe(`[raw] Host-injected file reference. ${RAW_FIELD_MARKER}`),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      sanitized.handler(
        {
          file: {
            // download URLs legitimately contain query params + percent-encoding
            download_url: "https://files.example.com/abc?token=xyz&v=2%20draft",
            file_id: "file-123",
          },
        } as any,
        {} as any,
      );
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("honors [raw] on an array schema — element strings pass through unsanitised", () => {
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        downloadUrls: z
          .array(z.string())
          .describe(`Pre-signed URLs from host. ${RAW_FIELD_MARKER}`),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      sanitized.handler(
        { downloadUrls: ["https://x.example.com/a?t=1", "https://x.example.com/b%20c"] } as any,
        {} as any,
      );
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("preserves the tool's `_meta` field when wrapping (openai/fileParams regression guard)", () => {
      // The decorator stack is the only thing between a tool declaration and
      // registerTool — if any wrapper strips _meta, the connector loses its
      // file-injection contract (umbraco/Umbraco-MCP-Base#127, #133).
      const handler = jest.fn().mockReturnValue({ content: [] });
      const tool = {
        name: "create-media-from-file",
        description: "",
        inputSchema: { file: z.object({ download_url: z.string() }) },
        handler,
        slices: [],
        _meta: { "openai/fileParams": ["file"] },
      } as any;

      const sanitized = withInputSanitization(tool);
      expect(sanitized._meta).toEqual({ "openai/fileParams": ["file"] });
    });

    it("fails loud on unsupported schema kinds (z.union with strings inside)", () => {
      // Silent fall-through here would have meant nested string content
      // reached the handler un-validated. The walker doesn't descend into
      // unions/records/tuples/lazy — it has to error so authors notice.
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        either: z.union([z.string(), z.literal("x")]),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      expect(() =>
        sanitized.handler({ either: "anything" } as any, {} as any),
      ).toThrow(/unsupported schema kind 'union'/);
      expect(handler).not.toHaveBeenCalled();
    });

    it("lets numbers, booleans, dates, enums pass through without erroring", () => {
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        count: z.number(),
        flag: z.boolean(),
        kind: z.enum(["a", "b"]),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);
      sanitized.handler({ count: 1, flag: true, kind: "a" } as any, {} as any);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("falls back to string sanitisation for top-level keys not declared in the schema", () => {
      // Defence-in-depth: the upstream MCP SDK normally strips unknown keys
      // via Zod parse, but the decorator is exported standalone. An undeclared
      // string with a control character shouldn't reach the handler.
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = { name: z.string() };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);
      expect(() =>
        sanitized.handler({ name: "clean", extra: "bad\x00value" } as any, {} as any),
      ).toThrow(ToolValidationError);
      expect(handler).not.toHaveBeenCalled();
    });

    it("ignores prototype-chain keys on the schema when looking up nested children", () => {
      // `if (schema[k])` would have resolved `constructor`/`toString` to
      // truthy prototype members; switched to hasOwnProperty. Confirm runtime
      // keys named `constructor` don't trigger a descent.
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = { wrapper: z.object({ ok: z.string() }) };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);
      sanitized.handler(
        { wrapper: { ok: "clean", constructor: "harmless" } } as any,
        {} as any,
      );
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("supports optional nested objects (z.object().optional()) without crashing", () => {
      const handler = jest.fn().mockReturnValue({ content: [] });
      const inputSchema = {
        file: z.object({ download_url: z.string() }).optional(),
        name: z.string(),
      };
      const tool = { name: "t", description: "", inputSchema, handler, slices: [] } as any;
      const sanitized = withInputSanitization(tool);

      // Missing optional field
      sanitized.handler({ name: "ok" } as any, {} as any);
      expect(handler).toHaveBeenCalledTimes(1);

      // Optional field present with valid content
      sanitized.handler(
        { file: { download_url: "https://files.example.com/abc" }, name: "ok" } as any,
        {} as any,
      );
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
