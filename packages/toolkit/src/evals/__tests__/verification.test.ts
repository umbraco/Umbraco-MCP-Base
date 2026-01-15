/**
 * Verification Helpers Tests
 *
 * Tests for verification utilities:
 * - verifyRequiredToolCalls - Check if required tools were called
 * - verifySuccessMessage - Check for success message in result
 * - verifyMcpConnection - Check if MCP server connected
 * - verifyToolsAvailable - Check if specific tools are available
 * - verifyToolCalledWithParams - Check tool calls with specific params
 * - getToolCalls - Get all calls to a specific tool
 * - assertTestPassed - Comprehensive assertion helper
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { AgentTestResult, ToolCall } from "../types.js";

// Store original console.log
const originalConsoleLog = console.log;

// Helper to reset modules and configure server name
async function getVerificationFresh(serverName: string = "test-server") {
  jest.resetModules();
  const { configureEvals } = await import("../config.js");
  configureEvals({ mcpServerName: serverName });
  return await import("../verification.js");
}

describe("Verification Helpers", () => {
  describe("verifyRequiredToolCalls", () => {
    it("should pass when all required tools were called", async () => {
      const { verifyRequiredToolCalls } = await getVerificationFresh("my-server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__my-server__tool-a", input: {} },
        { name: "mcp__my-server__tool-b", input: {} },
        { name: "mcp__my-server__tool-c", input: {} }
      ];

      const result = verifyRequiredToolCalls(toolCalls, ["tool-a", "tool-b"]);

      expect(result.passed).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.called).toEqual(["tool-a", "tool-b"]);
    });

    it("should fail when required tools were not called", async () => {
      const { verifyRequiredToolCalls } = await getVerificationFresh("my-server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__my-server__tool-a", input: {} }
      ];

      const result = verifyRequiredToolCalls(toolCalls, ["tool-a", "tool-b", "tool-c"]);

      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(["tool-b", "tool-c"]);
      expect(result.called).toEqual(["tool-a"]);
    });

    it("should pass with empty required tools", async () => {
      const { verifyRequiredToolCalls } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__some-tool", input: {} }
      ];

      const result = verifyRequiredToolCalls(toolCalls, []);

      expect(result.passed).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.called).toEqual([]);
    });

    it("should fail with empty tool calls when tools required", async () => {
      const { verifyRequiredToolCalls } = await getVerificationFresh("server");

      const result = verifyRequiredToolCalls([], ["required-tool"]);

      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(["required-tool"]);
    });

    it("should handle readonly arrays", async () => {
      const { verifyRequiredToolCalls } = await getVerificationFresh("my-server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__my-server__tool-a", input: {} }
      ];
      const required = ["tool-a"] as const;

      const result = verifyRequiredToolCalls(toolCalls, required);

      expect(result.passed).toBe(true);
    });

    it("should work with tools called multiple times", async () => {
      const { verifyRequiredToolCalls } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__repeated-tool", input: { call: 1 } },
        { name: "mcp__server__repeated-tool", input: { call: 2 } },
        { name: "mcp__server__other-tool", input: {} }
      ];

      const result = verifyRequiredToolCalls(toolCalls, ["repeated-tool", "other-tool"]);

      expect(result.passed).toBe(true);
    });
  });

  describe("verifySuccessMessage", () => {
    it("should find default success message", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      const result = verifySuccessMessage("The task has completed successfully.");

      expect(result).toBe(true);
    });

    it("should be case-insensitive for default message", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      expect(verifySuccessMessage("TASK HAS COMPLETED SUCCESSFULLY")).toBe(true);
      expect(verifySuccessMessage("Task Has Completed Successfully")).toBe(true);
    });

    it("should return false when default message not found", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      const result = verifySuccessMessage("Some other response without the magic phrase");

      expect(result).toBe(false);
    });

    it("should match custom string pattern (case-insensitive)", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      const result = verifySuccessMessage(
        "The document was created successfully!",
        "document was created"
      );

      expect(result).toBe(true);
    });

    it("should match custom RegExp pattern", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      const result = verifySuccessMessage(
        "Created item with ID: abc-123",
        /ID: [a-z]+-\d+/
      );

      expect(result).toBe(true);
    });

    it("should fail when custom string pattern not found", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      const result = verifySuccessMessage(
        "Operation failed",
        "success"
      );

      expect(result).toBe(false);
    });

    it("should fail when custom RegExp pattern not matched", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      const result = verifySuccessMessage(
        "No match here",
        /\d{4}-\d{2}-\d{2}/
      );

      expect(result).toBe(false);
    });

    it("should handle empty result string", async () => {
      const { verifySuccessMessage } = await getVerificationFresh();

      expect(verifySuccessMessage("")).toBe(false);
      expect(verifySuccessMessage("", "pattern")).toBe(false);
    });
  });

  describe("verifyMcpConnection", () => {
    it("should return true when tools are available", async () => {
      const { verifyMcpConnection } = await getVerificationFresh();

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: ["mcp__server__tool-a", "mcp__server__tool-b"],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(verifyMcpConnection(result)).toBe(true);
    });

    it("should return false when no tools available", async () => {
      const { verifyMcpConnection } = await getVerificationFresh();

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(verifyMcpConnection(result)).toBe(false);
    });

    it("should return true with just one tool", async () => {
      const { verifyMcpConnection } = await getVerificationFresh();

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: ["single-tool"],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(verifyMcpConnection(result)).toBe(true);
    });
  });

  describe("verifyToolsAvailable", () => {
    it("should pass when all expected tools are available", async () => {
      const { verifyToolsAvailable } = await getVerificationFresh("my-server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [
          "mcp__my-server__tool-a",
          "mcp__my-server__tool-b",
          "mcp__my-server__tool-c"
        ],
        tokens: { input: 0, output: 0, total: 0 }
      };

      const verification = verifyToolsAvailable(result, ["tool-a", "tool-c"]);

      expect(verification.passed).toBe(true);
      expect(verification.missing).toEqual([]);
    });

    it("should fail when expected tools are missing", async () => {
      const { verifyToolsAvailable } = await getVerificationFresh("my-server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: ["mcp__my-server__tool-a"],
        tokens: { input: 0, output: 0, total: 0 }
      };

      const verification = verifyToolsAvailable(result, ["tool-a", "tool-b", "tool-c"]);

      expect(verification.passed).toBe(false);
      expect(verification.missing).toEqual(["tool-b", "tool-c"]);
    });

    it("should pass with empty expected tools", async () => {
      const { verifyToolsAvailable } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      const verification = verifyToolsAvailable(result, []);

      expect(verification.passed).toBe(true);
    });

    it("should handle readonly expected tools array", async () => {
      const { verifyToolsAvailable } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: ["mcp__server__tool-x"],
        tokens: { input: 0, output: 0, total: 0 }
      };

      const expected = ["tool-x"] as const;
      const verification = verifyToolsAvailable(result, expected);

      expect(verification.passed).toBe(true);
    });
  });

  describe("verifyToolCalledWithParams", () => {
    it("should return true when tool was called (no params check)", async () => {
      const { verifyToolCalledWithParams } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__my-tool", input: { any: "params" } }
      ];

      const result = verifyToolCalledWithParams(toolCalls, "my-tool");

      expect(result).toBe(true);
    });

    it("should return false when tool was not called", async () => {
      const { verifyToolCalledWithParams } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__other-tool", input: {} }
      ];

      const result = verifyToolCalledWithParams(toolCalls, "my-tool");

      expect(result).toBe(false);
    });

    it("should return true when called with matching params", async () => {
      const { verifyToolCalledWithParams } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        {
          name: "mcp__server__create-item",
          input: { name: "Test Item", type: "document" }
        }
      ];

      const result = verifyToolCalledWithParams(
        toolCalls,
        "create-item",
        { name: "Test Item" }
      );

      expect(result).toBe(true);
    });

    it("should return false when params don't match", async () => {
      const { verifyToolCalledWithParams } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        {
          name: "mcp__server__create-item",
          input: { name: "Different Name", type: "document" }
        }
      ];

      const result = verifyToolCalledWithParams(
        toolCalls,
        "create-item",
        { name: "Expected Name" }
      );

      expect(result).toBe(false);
    });

    it("should match if any call has matching params", async () => {
      const { verifyToolCalledWithParams } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__my-tool", input: { id: "first" } },
        { name: "mcp__server__my-tool", input: { id: "second" } },
        { name: "mcp__server__my-tool", input: { id: "target" } }
      ];

      const result = verifyToolCalledWithParams(
        toolCalls,
        "my-tool",
        { id: "target" }
      );

      expect(result).toBe(true);
    });

    it("should require all expected params to match", async () => {
      const { verifyToolCalledWithParams } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        {
          name: "mcp__server__complex-tool",
          input: { a: 1, b: 2, c: 3 }
        }
      ];

      // Only a and b match
      const result = verifyToolCalledWithParams(
        toolCalls,
        "complex-tool",
        { a: 1, b: 2, c: 999 }
      );

      expect(result).toBe(false);
    });

    it("should handle empty tool calls", async () => {
      const { verifyToolCalledWithParams } = await getVerificationFresh("server");

      const result = verifyToolCalledWithParams([], "any-tool");

      expect(result).toBe(false);
    });
  });

  describe("getToolCalls", () => {
    it("should return all calls to specified tool", async () => {
      const { getToolCalls } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__target-tool", input: { call: 1 } },
        { name: "mcp__server__other-tool", input: { call: 2 } },
        { name: "mcp__server__target-tool", input: { call: 3 } },
        { name: "mcp__server__target-tool", input: { call: 4 } }
      ];

      const result = getToolCalls(toolCalls, "target-tool");

      expect(result).toHaveLength(3);
      expect(result[0].input).toEqual({ call: 1 });
      expect(result[1].input).toEqual({ call: 3 });
      expect(result[2].input).toEqual({ call: 4 });
    });

    it("should return empty array when tool not called", async () => {
      const { getToolCalls } = await getVerificationFresh("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__other-tool", input: {} }
      ];

      const result = getToolCalls(toolCalls, "not-called-tool");

      expect(result).toEqual([]);
    });

    it("should return empty array for empty tool calls", async () => {
      const { getToolCalls } = await getVerificationFresh("server");

      const result = getToolCalls([], "any-tool");

      expect(result).toEqual([]);
    });

    it("should preserve full tool call objects", async () => {
      const { getToolCalls } = await getVerificationFresh("server");

      const complexInput = { nested: { data: [1, 2, 3] } };
      const toolCalls: ToolCall[] = [
        { name: "mcp__server__tool", input: complexInput }
      ];

      const result = getToolCalls(toolCalls, "tool");

      expect(result[0].name).toBe("mcp__server__tool");
      expect(result[0].input).toEqual(complexInput);
    });
  });

  describe("assertTestPassed", () => {
    let consoleOutput: string[] = [];

    beforeEach(() => {
      consoleOutput = [];
      console.log = jest.fn((...args: any[]) => {
        consoleOutput.push(args.join(" "));
      });
    });

    afterEach(() => {
      console.log = originalConsoleLog;
    });

    it("should pass when all conditions met", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [
          { name: "mcp__server__required-tool", input: {} }
        ],
        toolResults: [],
        finalResult: "Completed",
        success: true,
        cost: 0.01,
        turns: 2,
        availableTools: [],
        tokens: { input: 100, output: 50, total: 150 }
      };

      // Should not throw
      expect(() => assertTestPassed(result, ["required-tool"])).not.toThrow();
    });

    it("should fail when success is false", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "Failed",
        success: false,
        cost: 0,
        turns: 1,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(() => assertTestPassed(result, [])).toThrow();
    });

    it("should fail when required tools missing", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(() => assertTestPassed(result, ["missing-tool"])).toThrow();
    });

    it("should log on failure by default", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "Some result",
        success: false,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      try {
        assertTestPassed(result, []);
      } catch {
        // Expected
      }

      expect(consoleOutput.some(o => o.includes("Test failed"))).toBe(true);
    });

    it("should not log when logOnFailure is false", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: false,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      try {
        assertTestPassed(result, [], { logOnFailure: false });
      } catch {
        // Expected
      }

      expect(consoleOutput).toHaveLength(0);
    });

    it("should verify success message when requireSuccessMessage is true", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "The task has completed successfully.",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(() => assertTestPassed(result, [], {
        requireSuccessMessage: true
      })).not.toThrow();
    });

    it("should fail when success message required but not found", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "Done",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(() => assertTestPassed(result, [], {
        requireSuccessMessage: true
      })).toThrow();
    });

    it("should use custom success pattern when provided", async () => {
      const { assertTestPassed } = await getVerificationFresh("server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "Document created with ID: 12345",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      expect(() => assertTestPassed(result, [], {
        requireSuccessMessage: true,
        customSuccessPattern: /ID: \d+/
      })).not.toThrow();
    });
  });
});
