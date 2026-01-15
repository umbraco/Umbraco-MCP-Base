/**
 * MCP Chaining Eval Tests
 *
 * These tests verify that the MCP chaining functionality works correctly.
 * They use the Claude Agent SDK to verify that proxied tools from chained
 * MCP servers are accessible and functional.
 *
 * Requirements:
 * - Chained MCP server (cms) must be available (@umbraco-cms/mcp-dev)
 * - Running Umbraco instance with valid credentials
 *
 * These are integration tests that require external infrastructure.
 * To run these tests:
 * 1. Ensure you have a running Umbraco instance
 * 2. Set UMBRACO_CLIENT_ID, UMBRACO_CLIENT_SECRET, UMBRACO_BASE_URL env vars
 * 3. Set RUN_CHAINING_TESTS=true
 */

import "../../../tools/example/__evals__/setup.js";
import { describe, it } from "@jest/globals";
import {
  runScenarioTest,
  setupConsoleMock,
  getDefaultTimeoutMs,
} from "@umbraco-cms/mcp-toolkit/evals";

// Skip these tests unless explicitly enabled (requires real Umbraco instance)
const shouldRunChainingTests = process.env.RUN_CHAINING_TESTS === "true";

const describeOrSkip = shouldRunChainingTests ? describe : describe.skip;

describeOrSkip("MCP Chaining", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "should call a proxied tool from the chained MCP server",
    runScenarioTest({
      prompt: `You have access to tools from a chained MCP server with the "cms:" prefix.
Use one of the available cms: tools to retrieve some information from the server.
Report what you found.`,
      tools: ["cms:*"],
      requiredTools: [],
      successPattern: /success|found|retrieved|returned|result|version|umbraco/i,
      verbose: true,
    }),
    timeout
  );

  it(
    "should successfully complete a read operation via chained tool",
    runScenarioTest({
      prompt: `Use a read-only tool from the chained cms: server to get information.
This could be server info, a list of items, or any other read operation.
Report what the tool returned.`,
      tools: ["cms:*"],
      requiredTools: [],
      successPattern: /success|data|info|list|items?|version|server/i,
      verbose: true,
    }),
    timeout
  );
});
