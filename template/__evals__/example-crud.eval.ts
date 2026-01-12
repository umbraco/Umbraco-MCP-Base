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
} from "@umbraco-cms/mcp-toolkit/evals";

describe("Example CRUD Operations", () => {
  setupConsoleMock();

  const timeout = getDefaultTimeoutMs();

  it(
    "should list examples",
    runScenarioTest({
      prompt: `List all example items using the available tools.
        After listing, report what you found.`,
      tools: ["list-examples"],
      requiredTools: ["list-examples"],
      successPattern: /item|found|list/i,
    }),
    timeout
  );

  it(
    "should create and retrieve an example",
    runScenarioTest({
      prompt: `Complete these tasks in order:
        1. Create a new example item with the name "Test Item" and description "Created by eval test"
        2. Get the item you just created using its ID
        3. Confirm you successfully retrieved the item by saying "Task completed successfully"`,
      tools: ["create-example", "get-example"],
      requiredTools: ["create-example", "get-example"],
      successPattern: "Task completed successfully",
    }),
    timeout
  );

  it(
    "should search for examples",
    runScenarioTest({
      prompt: `Search for example items containing "Sample" in their name.
        Report what you found.`,
      tools: ["search-examples"],
      requiredTools: ["search-examples"],
      successPattern: /sample|found|search/i,
    }),
    timeout
  );

  it(
    "should update an example",
    runScenarioTest({
      prompt: `Complete these tasks:
        1. First list all examples to find an existing item
        2. Update the first item you find, changing its name to "Updated Item"
        3. Confirm the update was successful by saying "Update completed"`,
      tools: ["list-examples", "update-example"],
      requiredTools: ["list-examples", "update-example"],
      successPattern: "Update completed",
    }),
    timeout
  );

  it(
    "should create and delete an example",
    runScenarioTest({
      prompt: `Complete these tasks:
        1. Create a new example item named "_ToDelete" with description "Will be deleted"
        2. Delete the item you just created using its ID
        3. Confirm both operations succeeded by saying "Create and delete completed"`,
      tools: ["create-example", "delete-example"],
      requiredTools: ["create-example", "delete-example"],
      successPattern: "Create and delete completed",
    }),
    timeout
  );
});

describe("Example Error Handling", () => {
  setupConsoleMock();

  const timeout = getDefaultTimeoutMs();

  it(
    "should handle not found gracefully",
    runScenarioTest({
      prompt: `Try to get an example item with ID "00000000-0000-0000-0000-000000000000".
        This ID doesn't exist. Report what happened - did you get an error?
        Say "Error handled correctly" if you received a not found error.`,
      tools: ["get-example"],
      requiredTools: ["get-example"],
      successPattern: /error|not found|handled/i,
    }),
    timeout
  );

  it(
    "should reject reserved names",
    runScenarioTest({
      prompt: `Try to create an example item with the name "_reserved_test".
        This should fail because names starting with "_reserved_" are not allowed.
        Report what happened. Say "Validation error handled" if you got an error.`,
      tools: ["create-example"],
      requiredTools: ["create-example"],
      successPattern: /validation|error|handled|rejected/i,
    }),
    timeout
  );
});
