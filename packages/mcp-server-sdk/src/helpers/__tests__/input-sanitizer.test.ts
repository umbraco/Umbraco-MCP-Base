/**
 * Input Sanitizer Tests
 *
 * Tests for input validation functions that protect against agent hallucinations.
 */

import { jest, describe, it, expect } from "@jest/globals";
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

  it("should allow absolute paths starting with /", () => {
    // Umbraco uses /-prefixed paths as identifiers for stylesheets, scripts, etc.
    expect(() => rejectPathTraversal("/stylesheet.css", "field")).not.toThrow();
    expect(() => rejectPathTraversal("/scripts/app.js", "field")).not.toThrow();
    expect(() => rejectPathTraversal("/Views/Partials/header.cshtml", "field")).not.toThrow();
  });

  it("should reject UNC paths and Windows absolute paths", () => {
    expect(() => rejectPathTraversal("\\\\server\\share", "field")).toThrow(ToolValidationError);
    expect(() => rejectPathTraversal("C:\\Windows", "field")).toThrow(ToolValidationError);
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
});
