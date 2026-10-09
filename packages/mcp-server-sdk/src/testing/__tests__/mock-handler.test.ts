/**
 * Mock Handler Tests
 *
 * Tests for validateErrorResult against real createToolResultError output.
 */

import { describe, it, expect } from "@jest/globals";
import { validateErrorResult } from "../mock-handler.js";
import { createToolResultError } from "../../helpers/tool-result.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

describe("validateErrorResult", () => {
  const problemDetails = {
    type: "Error",
    title: "Not Found",
    status: 404,
    detail: "The item was not found",
  };

  it("returns the ProblemDetails from a createToolResultError result", () => {
    const result = createToolResultError(problemDetails);
    expect(validateErrorResult(result)).toEqual(problemDetails);
  });

  it("falls back to structuredContent for results from older servers", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: "not json" }],
      structuredContent: problemDetails,
      isError: true,
    };
    expect(validateErrorResult(result)).toEqual(problemDetails);
  });

  it("throws when the result is not an error", () => {
    expect(() => validateErrorResult({ content: [] })).toThrow("Expected result.isError to be true");
  });

  it("throws when the text is not valid ProblemDetails JSON and there is no structuredContent", () => {
    expect(() => validateErrorResult(createToolResultError("plain message"))).toThrow();
  });
});
