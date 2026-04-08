/**
 * Cursor Pagination Tests
 */

import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import {
  encodeCursor,
  decodeCursor,
  computeNextCursor,
  withCursorPagination,
} from "../cursor-pagination.js";
import type { ToolDefinition } from "../../types/tool-definition.js";

// ============================================================================
// encodeCursor / decodeCursor
// ============================================================================

describe("encodeCursor / decodeCursor", () => {
  it("should roundtrip encode and decode", () => {
    const state = { s: 100, t: 50 };
    const cursor = encodeCursor(state);
    expect(decodeCursor(cursor)).toEqual(state);
  });

  it("should produce base64url strings (no +, /, =)", () => {
    const cursor = encodeCursor({ s: 999, t: 999 });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("should throw on invalid base64", () => {
    expect(() => decodeCursor("not-valid!!!")).toThrow("Invalid pagination cursor");
  });

  it("should throw on valid base64 but invalid JSON", () => {
    const bad = Buffer.from("not json").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("Invalid pagination cursor");
  });

  it("should throw on missing fields", () => {
    const bad = Buffer.from(JSON.stringify({ s: 0 })).toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("Invalid pagination cursor");
  });

  it("should throw on negative skip", () => {
    const bad = Buffer.from(JSON.stringify({ s: -1, t: 10 })).toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("Invalid pagination cursor");
  });

  it("should throw on zero take", () => {
    const bad = Buffer.from(JSON.stringify({ s: 0, t: 0 })).toString("base64url");
    expect(() => decodeCursor(bad)).toThrow("Invalid pagination cursor");
  });
});

// ============================================================================
// computeNextCursor
// ============================================================================

describe("computeNextCursor", () => {
  it("should return cursor for middle page", () => {
    const cursor = computeNextCursor(0, 50, 200, 50);
    expect(cursor).not.toBeNull();
    const state = decodeCursor(cursor!);
    expect(state).toEqual({ s: 50, t: 50 });
  });

  it("should return null for last page", () => {
    expect(computeNextCursor(150, 50, 200, 50)).toBeNull();
  });

  it("should return null when items returned reaches total", () => {
    expect(computeNextCursor(0, 50, 30, 30)).toBeNull();
  });

  it("should return null for empty results", () => {
    expect(computeNextCursor(0, 50, 0, 0)).toBeNull();
  });

  it("should return null when skip + items >= total", () => {
    expect(computeNextCursor(180, 50, 200, 20)).toBeNull();
  });

  it("should handle exact boundary", () => {
    // 100 items total, page 1 returns 50, page 2 returns 50
    const page1 = computeNextCursor(0, 50, 100, 50);
    expect(page1).not.toBeNull();
    const page2 = computeNextCursor(50, 50, 100, 50);
    expect(page2).toBeNull();
  });
});

// ============================================================================
// withCursorPagination
// ============================================================================

function createMockTool(overrides?: Partial<ToolDefinition<any, any>>): ToolDefinition<any, any> {
  return {
    name: "test-tool",
    description: "A test tool",
    inputSchema: {
      skip: z.coerce.number().optional(),
      take: z.coerce.number().default(100),
      filter: z.string().optional(),
    },
    outputSchema: {
      total: z.number(),
      items: z.array(z.object({ id: z.string() })),
    },
    slices: ["list"],
    handler: async (args: any) => ({
      content: [{ type: "text" as const, text: JSON.stringify({ total: 200, items: Array(args.take).fill({ id: "1" }) }) }],
      structuredContent: { total: 200, items: Array(args.take).fill({ id: "1" }) },
    }),
    ...overrides,
  };
}

describe("withCursorPagination", () => {
  describe("detection", () => {
    it("should pass through tools without skip/take", () => {
      const tool = createMockTool({
        inputSchema: { id: z.string() },
      });
      const result = withCursorPagination(tool);
      expect(result).toBe(tool); // Same reference — unchanged
    });

    it("should pass through tools with only skip (no take)", () => {
      const tool = createMockTool({
        inputSchema: { skip: z.number().optional() },
      });
      const result = withCursorPagination(tool);
      expect(result).toBe(tool);
    });

    it("should pass through tools with no inputSchema", () => {
      const tool = createMockTool({ inputSchema: undefined });
      const result = withCursorPagination(tool);
      expect(result).toBe(tool);
    });

    it("should transform tools with both skip and take", () => {
      const tool = createMockTool();
      const result = withCursorPagination(tool);
      expect(result).not.toBe(tool);
    });
  });

  describe("input schema transformation", () => {
    it("should remove skip and take, add cursor", () => {
      const tool = createMockTool();
      const result = withCursorPagination(tool);

      expect(result.inputSchema).not.toHaveProperty("skip");
      expect(result.inputSchema).not.toHaveProperty("take");
      expect(result.inputSchema).toHaveProperty("cursor");
    });

    it("should preserve other params", () => {
      const tool = createMockTool();
      const result = withCursorPagination(tool);

      expect(result.inputSchema).toHaveProperty("filter");
      expect(result.inputSchema).toHaveProperty("cursor");
    });
  });

  describe("output schema transformation", () => {
    it("should add nextCursor to output schema", () => {
      const tool = createMockTool();
      const result = withCursorPagination(tool);

      expect(result.outputSchema).toHaveProperty("nextCursor");
      expect(result.outputSchema).toHaveProperty("total");
      expect(result.outputSchema).toHaveProperty("items");
    });
  });

  describe("handler", () => {
    it("should use default page size when no cursor provided", async () => {
      let capturedArgs: any;
      const tool = createMockTool({
        handler: async (args: any) => {
          capturedArgs = args;
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ total: 10, items: [] }) }],
            structuredContent: { total: 10, items: [] },
          };
        },
      });

      const result = withCursorPagination(tool);
      await result.handler({ filter: "test" }, {} as any);

      expect(capturedArgs.skip).toBe(0);
      expect(capturedArgs.take).toBe(100); // Default from zod schema
      expect(capturedArgs.filter).toBe("test");
    });

    it("should decode cursor and inject skip/take", async () => {
      let capturedArgs: any;
      const tool = createMockTool({
        handler: async (args: any) => {
          capturedArgs = args;
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ total: 200, items: Array(50).fill({ id: "1" }) }) }],
            structuredContent: { total: 200, items: Array(50).fill({ id: "1" }) },
          };
        },
      });

      const cursor = encodeCursor({ s: 100, t: 50 });
      const result = withCursorPagination(tool);
      await result.handler({ cursor }, {} as any);

      expect(capturedArgs.skip).toBe(100);
      expect(capturedArgs.take).toBe(50);
    });

    it("should use tool pageSize override", async () => {
      let capturedArgs: any;
      const tool = createMockTool({
        pageSize: 25,
        handler: async (args: any) => {
          capturedArgs = args;
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ total: 10, items: [] }) }],
            structuredContent: { total: 10, items: [] },
          };
        },
      });

      const result = withCursorPagination(tool);
      await result.handler({}, {} as any);

      expect(capturedArgs.take).toBe(25);
    });

    it("should use defaultPageSize option when no zod default and no pageSize", async () => {
      let capturedArgs: any;
      const tool = createMockTool({
        inputSchema: {
          skip: z.number().optional(),
          take: z.number().optional(), // No default
        },
        handler: async (args: any) => {
          capturedArgs = args;
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ total: 10, items: [] }) }],
            structuredContent: { total: 10, items: [] },
          };
        },
      });

      const result = withCursorPagination(tool, { defaultPageSize: 30 });
      await result.handler({}, {} as any);

      expect(capturedArgs.take).toBe(30);
    });

    it("should return error for invalid cursor", async () => {
      const tool = createMockTool();
      const result = withCursorPagination(tool);
      const response = await result.handler({ cursor: "garbage" }, {} as any);

      expect(response.isError).toBe(true);
      expect(response.structuredContent).toMatchObject({
        title: "Invalid Cursor",
        status: 400,
      });
    });
  });

  describe("response transformation", () => {
    it("should add nextCursor to structuredContent when more pages exist", async () => {
      const tool = createMockTool();
      const result = withCursorPagination(tool);
      const response = await result.handler({}, {} as any);

      expect(response.structuredContent.nextCursor).toBeDefined();
      const nextState = decodeCursor(response.structuredContent.nextCursor);
      expect(nextState.s).toBe(100); // 0 + 100 items
    });

    it("should not include nextCursor on last page", async () => {
      const tool = createMockTool({
        handler: async (args: any) => ({
          content: [{ type: "text" as const, text: JSON.stringify({ total: 30, items: Array(30).fill({ id: "1" }) }) }],
          structuredContent: { total: 30, items: Array(30).fill({ id: "1" }) },
        }),
      });

      const result = withCursorPagination(tool);
      const response = await result.handler({}, {} as any);

      expect(response.structuredContent.nextCursor).toBeUndefined();
    });

    it("should update text content fallback too", async () => {
      const tool = createMockTool();
      const result = withCursorPagination(tool);
      const response = await result.handler({}, {} as any);

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.nextCursor).toBeDefined();
    });
  });

  describe("preserves other properties", () => {
    it("should keep name, description, slices, annotations", () => {
      const tool = createMockTool({
        annotations: { readOnlyHint: true, openWorldHint: true },
      });
      const result = withCursorPagination(tool);

      expect(result.name).toBe("test-tool");
      expect(result.description).toBe("A test tool");
      expect(result.slices).toEqual(["list"]);
      expect(result.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    });
  });
});
