/**
 * Agent Runner Tests
 *
 * Tests for agent runner functions:
 * - runAgentTest - Main function for running agent tests (mocked SDK)
 * - getShortToolName - Strips MCP prefix from tool names
 * - getFullToolName - Adds MCP prefix to tool names
 * - formatToolCalls - Formats tool calls for logging
 * - logTestResult - Console logging for test results
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { AgentTestResult, ToolCall } from "../types.js";

// Store original console.log
const originalConsoleLog = console.log;

// Helper to reset modules and get fresh imports
async function getAgentRunnerFresh() {
  jest.resetModules();
  return await import("../agent-runner.js");
}

// Helper to configure with a specific server name
async function configureServerName(name: string) {
  jest.resetModules();
  const { configureEvals } = await import("../config.js");
  configureEvals({ mcpServerName: name });
  return await import("../agent-runner.js");
}

/**
 * Creates an async generator that yields SDK messages for testing.
 */
async function* createMockQueryGenerator(messages: any[]): AsyncGenerator<any> {
  for (const message of messages) {
    yield message;
  }
}

/**
 * Mock SDK message factories
 */
const mockMessages = {
  init: (tools: string[]) => ({
    type: "system",
    subtype: "init",
    tools
  }),

  assistantText: (text: string) => ({
    type: "assistant",
    message: {
      content: [{ type: "text", text }]
    }
  }),

  assistantToolUse: (name: string, input: unknown) => ({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name, input }]
    }
  }),

  assistantMixed: (blocks: Array<{ type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown }>) => ({
    type: "assistant",
    message: { content: blocks }
  }),

  toolResult: (result: unknown) => ({
    type: "user",
    tool_use_result: result
  }),

  successResult: (result: string, opts?: { cost?: number; turns?: number; inputTokens?: number; outputTokens?: number }) => ({
    type: "result",
    subtype: "success",
    result,
    total_cost_usd: opts?.cost ?? 0.01,
    num_turns: opts?.turns ?? 1,
    usage: {
      input_tokens: opts?.inputTokens ?? 100,
      output_tokens: opts?.outputTokens ?? 50
    }
  }),

  failureResult: () => ({
    type: "result",
    subtype: "error"
  })
};

describe("Agent Runner Helpers", () => {
  describe("getShortToolName", () => {
    it("should strip MCP prefix from tool name", async () => {
      const { getShortToolName } = await configureServerName("umbraco-mcp");

      const result = getShortToolName("mcp__umbraco-mcp__get-document");

      expect(result).toBe("get-document");
    });

    it("should handle tool names with hyphens", async () => {
      const { getShortToolName } = await configureServerName("my-server");

      const result = getShortToolName("mcp__my-server__create-data-type");

      expect(result).toBe("create-data-type");
    });

    it("should handle tool names with underscores", async () => {
      const { getShortToolName } = await configureServerName("test-server");

      const result = getShortToolName("mcp__test-server__get_all_items");

      expect(result).toBe("get_all_items");
    });

    it("should return original if no prefix found", async () => {
      const { getShortToolName } = await configureServerName("my-server");

      const result = getShortToolName("different-tool-name");

      expect(result).toBe("different-tool-name");
    });

    it("should handle empty string", async () => {
      const { getShortToolName } = await configureServerName("my-server");

      const result = getShortToolName("");

      expect(result).toBe("");
    });

    it("should work with default server name", async () => {
      const { getShortToolName } = await getAgentRunnerFresh();

      const result = getShortToolName("mcp__mcp-server__my-tool");

      expect(result).toBe("my-tool");
    });
  });

  describe("getFullToolName", () => {
    it("should add MCP prefix to short tool name", async () => {
      const { getFullToolName } = await configureServerName("umbraco-mcp");

      const result = getFullToolName("get-document");

      expect(result).toBe("mcp__umbraco-mcp__get-document");
    });

    it("should handle tool names with special characters", async () => {
      const { getFullToolName } = await configureServerName("my-server");

      const result = getFullToolName("list_all-items");

      expect(result).toBe("mcp__my-server__list_all-items");
    });

    it("should handle empty tool name", async () => {
      const { getFullToolName } = await configureServerName("test");

      const result = getFullToolName("");

      expect(result).toBe("mcp__test__");
    });

    it("should work with default server name", async () => {
      const { getFullToolName } = await getAgentRunnerFresh();

      const result = getFullToolName("my-tool");

      expect(result).toBe("mcp__mcp-server__my-tool");
    });
  });

  describe("getShortToolName and getFullToolName roundtrip", () => {
    it("should be inverse operations", async () => {
      const { getShortToolName, getFullToolName } = await configureServerName("roundtrip-server");

      const original = "test-tool";
      const full = getFullToolName(original);
      const short = getShortToolName(full);

      expect(short).toBe(original);
    });
  });

  describe("formatToolCalls", () => {
    it("should format tool calls as comma-separated short names", async () => {
      const { formatToolCalls } = await configureServerName("umbraco-mcp");

      const toolCalls: ToolCall[] = [
        { name: "mcp__umbraco-mcp__get-document", input: {} },
        { name: "mcp__umbraco-mcp__list-documents", input: {} },
        { name: "mcp__umbraco-mcp__create-document", input: {} }
      ];

      const result = formatToolCalls(toolCalls);

      expect(result).toBe("get-document, list-documents, create-document");
    });

    it("should handle single tool call", async () => {
      const { formatToolCalls } = await configureServerName("test-server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__test-server__single-tool", input: { param: "value" } }
      ];

      const result = formatToolCalls(toolCalls);

      expect(result).toBe("single-tool");
    });

    it("should handle empty tool calls array", async () => {
      const { formatToolCalls } = await getAgentRunnerFresh();

      const result = formatToolCalls([]);

      expect(result).toBe("");
    });

    it("should preserve input in tool calls (not affect output)", async () => {
      const { formatToolCalls } = await configureServerName("server");

      const toolCalls: ToolCall[] = [
        { name: "mcp__server__tool", input: { complex: { nested: "data" } } }
      ];

      const result = formatToolCalls(toolCalls);

      expect(result).toBe("tool");
      // Input should still be intact
      expect(toolCalls[0].input).toEqual({ complex: { nested: "data" } });
    });
  });

  describe("logTestResult", () => {
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

    it("should log test name when provided", async () => {
      const { logTestResult } = await configureServerName("test-server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "Test completed",
        success: true,
        cost: 0.0123,
        turns: 3,
        availableTools: [],
        tokens: { input: 100, output: 50, total: 150 }
      };

      logTestResult(result, "My Test Case");

      expect(consoleOutput.some(o => o.includes("=== My Test Case ==="))).toBe(true);
    });

    it("should not log test name when not provided", async () => {
      const { logTestResult } = await configureServerName("test-server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "Done",
        success: true,
        cost: 0.01,
        turns: 1,
        availableTools: [],
        tokens: { input: 10, output: 5, total: 15 }
      };

      logTestResult(result);

      expect(consoleOutput.every(o => !o.includes("==="))).toBe(true);
    });

    it("should log available tools", async () => {
      const { logTestResult } = await configureServerName("my-server");

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: ["mcp__my-server__tool-a", "mcp__my-server__tool-b"],
        tokens: { input: 0, output: 0, total: 0 }
      };

      logTestResult(result);

      expect(consoleOutput.some(o => o.includes("Tools available:"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("tool-a"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("tool-b"))).toBe(true);
    });

    it("should log tool calls made", async () => {
      const { logTestResult } = await configureServerName("test");

      const result: AgentTestResult = {
        toolCalls: [
          { name: "mcp__test__first-tool", input: {} },
          { name: "mcp__test__second-tool", input: {} }
        ],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      logTestResult(result);

      expect(consoleOutput.some(o => o.includes("Tools called:"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("first-tool"))).toBe(true);
    });

    it("should truncate long final results", async () => {
      const { logTestResult } = await getAgentRunnerFresh();

      const longResult = "A".repeat(500);
      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: longResult,
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      logTestResult(result);

      const previewLog = consoleOutput.find(o => o.includes("Final result preview:"));
      expect(previewLog).toBeDefined();
      expect(previewLog!.includes("...")).toBe(true);
      // Should not contain the full 500 characters
      expect(previewLog!.length).toBeLessThan(longResult.length + 50);
    });

    it("should not truncate short final results", async () => {
      const { logTestResult } = await getAgentRunnerFresh();

      const shortResult = "Short result";
      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: shortResult,
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      logTestResult(result);

      const previewLog = consoleOutput.find(o => o.includes("Final result preview:"));
      expect(previewLog).toBeDefined();
      expect(previewLog!.includes("Short result")).toBe(true);
      expect(previewLog!.includes("...")).toBe(false);
    });

    it("should log cost formatted to 4 decimal places", async () => {
      const { logTestResult } = await getAgentRunnerFresh();

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0.0567,
        turns: 0,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      logTestResult(result);

      expect(consoleOutput.some(o => o.includes("Cost: $0.0567"))).toBe(true);
    });

    it("should log token counts", async () => {
      const { logTestResult } = await getAgentRunnerFresh();

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 0,
        availableTools: [],
        tokens: { input: 1234, output: 567, total: 1801 }
      };

      logTestResult(result);

      expect(consoleOutput.some(o => o.includes("Tokens: 1801"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("in: 1234"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("out: 567"))).toBe(true);
    });

    it("should log turns and success status", async () => {
      const { logTestResult } = await getAgentRunnerFresh();

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: true,
        cost: 0,
        turns: 5,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      logTestResult(result);

      expect(consoleOutput.some(o => o.includes("Turns: 5"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("Success: true"))).toBe(true);
    });

    it("should log failure status correctly", async () => {
      const { logTestResult } = await getAgentRunnerFresh();

      const result: AgentTestResult = {
        toolCalls: [],
        toolResults: [],
        finalResult: "",
        success: false,
        cost: 0,
        turns: 2,
        availableTools: [],
        tokens: { input: 0, output: 0, total: 0 }
      };

      logTestResult(result);

      expect(consoleOutput.some(o => o.includes("Success: false"))).toBe(true);
    });
  });
});
