import { describe, it, expect } from "@jest/globals";
import { resolveToolCallParams, toolCallExtraIndex } from "../tool-call-params.js";

describe("toolCallExtraIndex", () => {
  it("is 1 for a two-argument call (tool with an inputSchema)", () => {
    expect(toolCallExtraIndex([{ id: "1" }, { sessionId: "s" }])).toBe(1);
  });

  it("is 0 for a one-argument call (tool with no inputSchema)", () => {
    expect(toolCallExtraIndex([{ sessionId: "s" }])).toBe(0);
  });
});

describe("resolveToolCallParams", () => {
  it("splits a two-argument call into args and context", () => {
    const args = { id: "1" };
    const context = { sessionId: "s" };
    expect(resolveToolCallParams([args, context])).toEqual({ args, context });
  });

  it("treats the sole argument of a one-argument call as context, args as undefined", () => {
    const context = { sessionId: "s" };
    expect(resolveToolCallParams([context])).toEqual({ args: undefined, context });
  });
});
