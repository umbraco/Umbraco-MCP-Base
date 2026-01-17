/**
 * MCP Chaining Eval Tests
 *
 * Demonstrates how local tools can call tools on chained MCP servers.
 *
 * This test verifies the pattern shown in `src/tools/chained/get-chained-info.ts`:
 * - A local tool imports mcpClientManager
 * - Calls mcpClientManager.callTool() to invoke a tool on a chained server
 * - Returns combined/enriched data
 *
 * The chaining infrastructure itself is tested in the toolkit package.
 * This test demonstrates the pattern for template users.
 *
 * Uses a mock MCP server (via USE_MOCK_MCP_CHAIN=true) so no real Umbraco
 * instance is required.
 */

import "../example/__evals__/setup.js";
import { describe, it, expect } from "@jest/globals";
import {
  runAgentTest,
  getShortToolName,
  setupConsoleMock,
  getDefaultTimeoutMs,
} from "@umbraco-cms/mcp-server-sdk/evals";

/**
 * Server env for chaining tests.
 * Uses mock MCP chain server (no real Umbraco required).
 */
const CHAINING_ENV = {
  // Use mock MCP server for chaining
  USE_MOCK_MCP_CHAIN: "true",
  USE_MOCK_API: "true",
  // Enable MCP chaining (override the default setup which disables it)
  DISABLE_MCP_CHAINING: "false",
  // Dummy credentials (required by server config validation)
  UMBRACO_CLIENT_ID: "test-client",
  UMBRACO_CLIENT_SECRET: "test-secret",
  UMBRACO_BASE_URL: "http://localhost:9999",
};

describe("MCP Chaining - Local Tool Delegation", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "should allow local tools to call chained tools via mcpClientManager",
    async () => {
      // This test demonstrates the pattern from src/tools/chained/get-chained-info.ts
      // The local tool internally calls mcpClientManager.callTool("cms", "get-server-info", {})
      const result = await runAgentTest(
        `Use the get-chained-info tool to get server information.
This tool internally delegates to the chained MCP server.
Report what the tool returned, including the source field.`,
        [],
        {
          serverEnv: CHAINING_ENV,
          useServerFiltering: true,
          verbosity: "verbose",
        }
      );

      // Verify the local tool was called (not the proxied cms_ tool directly)
      const chainedToolCalls = result.toolCalls.filter(
        (tc) => getShortToolName(tc.name) === "get-chained-info"
      );

      expect(chainedToolCalls.length).toBeGreaterThan(0);
      expect(result.success).toBe(true);
      // The response should mention the chained source (set by get-chained-info.ts)
      // This proves the local tool successfully delegated to the chained server
      expect(result.finalResult).toMatch(/chained|Mock CMS Server/i);
    },
    timeout
  );
});
