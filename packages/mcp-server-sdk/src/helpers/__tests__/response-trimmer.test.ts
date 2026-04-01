/**
 * Response Trimmer Tests
 *
 * Tests for context window discipline utilities.
 */

import { describe, it, expect } from "@jest/globals";
import {
  trimArrayResponse,
  summarizeDeepResponse,
  estimateTokenSize,
  pickFields,
  omitFields,
} from "../response-trimmer.js";

describe("trimArrayResponse", () => {
  it("should not truncate arrays under the limit", () => {
    const data = [1, 2, 3];
    const result = trimArrayResponse(data, { maxItems: 10 });
    expect(result.items).toEqual([1, 2, 3]);
    expect(result._truncated).toBe(false);
    expect(result._totalAvailable).toBe(3);
  });

  it("should truncate arrays over the limit", () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const result = trimArrayResponse(data, { maxItems: 10 });
    expect(result.items).toHaveLength(10);
    expect(result.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result._truncated).toBe(true);
    expect(result._totalAvailable).toBe(100);
  });

  it("should use default maxItems of 50", () => {
    const data = Array.from({ length: 60 }, (_, i) => i);
    const result = trimArrayResponse(data);
    expect(result.items).toHaveLength(50);
    expect(result._truncated).toBe(true);
    expect(result._totalAvailable).toBe(60);
  });

  it("should handle arrays exactly at the limit", () => {
    const data = [1, 2, 3];
    const result = trimArrayResponse(data, { maxItems: 3 });
    expect(result.items).toEqual([1, 2, 3]);
    expect(result._truncated).toBe(false);
  });

  it("should handle empty arrays", () => {
    const result = trimArrayResponse([], { maxItems: 10 });
    expect(result.items).toEqual([]);
    expect(result._truncated).toBe(false);
    expect(result._totalAvailable).toBe(0);
  });
});

describe("summarizeDeepResponse", () => {
  it("should preserve shallow structures", () => {
    const data = { name: "test", value: 42 };
    const result = summarizeDeepResponse(data, { maxDepth: 3 });
    expect(result).toEqual({ name: "test", value: 42 });
  });

  it("should collapse objects beyond max depth", () => {
    const data = {
      level1: {
        level2: {
          level3: {
            deep: "value",
            another: "key",
          },
        },
      },
    };
    const result = summarizeDeepResponse(data, { maxDepth: 3 }) as any;
    expect(typeof result.level1.level2.level3).toBe("string");
    expect(result.level1.level2.level3).toContain("Object");
    expect(result.level1.level2.level3).toContain("2 keys");
  });

  it("should collapse arrays beyond max depth", () => {
    const data = {
      level1: {
        level2: {
          items: [1, 2, 3],
        },
      },
    };
    const result = summarizeDeepResponse(data, { maxDepth: 3 }) as any;
    expect(typeof result.level1.level2.items).toBe("string");
    expect(result.level1.level2.items).toContain("Array");
    expect(result.level1.level2.items).toContain("3 items");
  });

  it("should handle null and undefined", () => {
    expect(summarizeDeepResponse(null)).toBeNull();
    expect(summarizeDeepResponse(undefined)).toBeUndefined();
  });

  it("should handle primitives", () => {
    expect(summarizeDeepResponse("hello")).toBe("hello");
    expect(summarizeDeepResponse(42)).toBe(42);
    expect(summarizeDeepResponse(true)).toBe(true);
  });

  it("should use default maxDepth of 3", () => {
    const data = { a: { b: { c: { d: "deep" } } } };
    const result = summarizeDeepResponse(data) as any;
    expect(typeof result.a.b.c).toBe("string");
  });
});

describe("estimateTokenSize", () => {
  it("should estimate tokens as chars/4", () => {
    expect(estimateTokenSize("1234")).toBe(1);
    expect(estimateTokenSize("12345678")).toBe(2);
  });

  it("should handle objects by serializing to JSON", () => {
    const data = { key: "value" };
    const json = JSON.stringify(data);
    expect(estimateTokenSize(data)).toBe(Math.ceil(json.length / 4));
  });

  it("should round up", () => {
    expect(estimateTokenSize("12345")).toBe(2);
  });
});

describe("pickFields", () => {
  it("should pick specified fields", () => {
    const data = { a: 1, b: 2, c: 3 };
    expect(pickFields(data, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("should ignore missing fields", () => {
    const data = { a: 1 };
    expect(pickFields(data, ["a", "missing"])).toEqual({ a: 1 });
  });

  it("should return empty object for no matching fields", () => {
    const data = { a: 1 };
    expect(pickFields(data, ["missing"])).toEqual({});
  });
});

describe("omitFields", () => {
  it("should omit specified fields", () => {
    const data = { a: 1, b: 2, c: 3 };
    expect(omitFields(data, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("should handle non-existent fields gracefully", () => {
    const data = { a: 1, b: 2 };
    expect(omitFields(data, ["missing"])).toEqual({ a: 1, b: 2 });
  });
});
