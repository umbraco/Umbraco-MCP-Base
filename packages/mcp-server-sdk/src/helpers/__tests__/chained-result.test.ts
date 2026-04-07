import { describe, it, expect } from "@jest/globals";
import { extractChainedResult } from "../chained-result.js";

describe("extractChainedResult", () => {
  it("should prefer structuredContent when present", () => {
    const result = {
      content: [{ type: "text", text: '{"fallback": true}' }],
      structuredContent: { preferred: true },
    };

    expect(extractChainedResult(result)).toEqual({ preferred: true });
  });

  it("should fall back to parsing text content", () => {
    const result = {
      content: [{ type: "text", text: '{"items": [1, 2, 3]}' }],
    };

    expect(extractChainedResult(result)).toEqual({ items: [1, 2, 3] });
  });

  it("should return raw text when JSON parse fails", () => {
    const result = {
      content: [{ type: "text", text: "not json" }],
    };

    expect(extractChainedResult(result)).toBe("not json");
  });

  it("should return undefined when no content", () => {
    expect(extractChainedResult({ content: [] })).toBeUndefined();
    expect(extractChainedResult({})).toBeUndefined();
  });

  it("should skip non-text content blocks", () => {
    const result = {
      content: [
        { type: "image", text: undefined },
        { type: "text", text: '{"found": true}' },
      ],
    };

    expect(extractChainedResult(result)).toEqual({ found: true });
  });

  it("should handle structuredContent with null value", () => {
    const result = {
      content: [{ type: "text", text: '{"fallback": true}' }],
      structuredContent: null,
    };

    // null is not undefined, so structuredContent is preferred
    expect(extractChainedResult(result)).toBeNull();
  });

  it("should handle error results", () => {
    const result = {
      content: [{ type: "text", text: '{"error": "not found"}' }],
      isError: true,
    };

    expect(extractChainedResult(result)).toEqual({ error: "not found" });
  });
});
