/**
 * MCP Chaining Eval Tests
 *
 * These tests verify that the MCP chaining functionality works correctly.
 * They use the Claude Agent SDK to verify that proxied tools from chained
 * MCP servers are accessible and functional.
 *
 * Requirements:
 * - Chained MCP server (cms) must be available
 * - Running Umbraco instance with valid credentials
 */

import "../../../tools/example/__evals__/setup.js";
import { describe, it } from "@jest/globals";
import {
  runScenarioTest,
  setupConsoleMock,
  getDefaultTimeoutMs,
} from "@umbraco-cms/mcp-toolkit/evals";

describe("MCP Chaining", () => {
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
