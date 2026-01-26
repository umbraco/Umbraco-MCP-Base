/**
 * Example CRUD Eval Tests
 *
 * These tests use the Claude Agent SDK to verify that the MCP tools
 * work correctly when invoked by an LLM agent.
 *
 * The agent is given a prompt and access to specific tools, then we verify:
 * - The correct tools were called
 * - The agent reports success
 *
 * These tests use the mock API client (USE_MOCK_API=true) so they don't
 * require a real Umbraco instance.
 */

import "./setup.js"; // Must be first - configures eval framework
import { describe, it } from "@jest/globals";
import {
  runScenarioTest,
  setupConsoleMock,
  getDefaultTimeoutMs,
} from "@umbraco-cms/mcp-server-sdk/evals";

describe("Example CRUD Operations", () => {
  setupConsoleMock();

  const timeout = getDefaultTimeoutMs();

  it(
    "should complete full CRUD workflow",
    runScenarioTest({
      prompt: `Complete the following tasks:
1. Create a new example item named "Agent Test Item" with description "Created by eval test"
2. List all items to confirm it was created
3. Update the item you created to change its name to "Updated Agent Item"
4. Delete the item you created
Report on each step as you complete it.`,
      tools: [
        "create-example",
        "list-examples",
        "get-example",
        "update-example",
        "delete-example",
      ],
      requiredTools: ["create-example", "list-examples", "update-example", "delete-example"],
      successPattern: /created|updated|deleted/i,
      verbose: true,
    }),
    timeout
  );
});

