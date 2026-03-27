/**
 * CLI Tool Calling Eval Tests
 *
 * Tests that an LLM agent can successfully call tools through the
 * CLI-configured MCP server. Covers CRUD workflows, filtering effects
 * on tool availability, and correct handling of different runtime modes.
 *
 * These complement cli-safety.test.ts which tests error recovery.
 * These tests focus on successful tool calling under different configs.
 */

import { describe, it, expect } from "@jest/globals";
import {
  runScenarioTest,
  runAgentTest,
  getShortToolName,
  getDefaultTimeoutMs,
  setupConsoleMock,
} from "@umbraco-cms/mcp-server-sdk/evals";

const BASE_ENV = {
  USE_MOCK_API: "true",
  DISABLE_MCP_CHAINING: "true",
  UMBRACO_CLIENT_ID: "test-client",
  UMBRACO_CLIENT_SECRET: "test-secret",
  UMBRACO_BASE_URL: "http://localhost:9999",
};

// ============================================================================
// Basic tool calling — CRUD operations
// ============================================================================

describe("Tool Calling — CRUD", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "agent can list items and get a specific one by ID",
    runScenarioTest({
      prompt: `List all example items. Then get the first item by its ID and tell me its name and description.`,
      tools: ["list-examples", "get-example"],
      requiredTools: ["list-examples", "get-example"],
      successPattern: /sample item|name|description/i,
      verbose: true,
    }),
    timeout
  );

  it(
    "agent can create an item and confirm it exists",
    runScenarioTest({
      prompt: `Create a new example item named "CLI Test" with description "Created via tool call". Then list all items to confirm it was created.`,
      tools: ["create-example", "list-examples"],
      requiredTools: ["create-example", "list-examples"],
      successPattern: /CLI Test|created/i,
      verbose: true,
    }),
    timeout
  );

  it(
    "agent can search for items by name",
    runScenarioTest({
      prompt: `Search for example items containing "Sample". Report how many results you found.`,
      tools: ["search-examples"],
      requiredTools: ["search-examples"],
      successPattern: /sample|found|result/i,
      verbose: true,
    }),
    timeout
  );

  it(
    "agent can update an existing item",
    runScenarioTest({
      prompt: `List all example items. Pick the first one and update its name to "Updated Item". Report the result.`,
      tools: ["list-examples", "update-example"],
      requiredTools: ["list-examples", "update-example"],
      successPattern: /updated/i,
      verbose: true,
    }),
    timeout
  );

  it(
    "agent can delete an item",
    runScenarioTest({
      prompt: `List all example items. Delete the last item in the list. Report which item you deleted.`,
      tools: ["list-examples", "delete-example"],
      requiredTools: ["list-examples", "delete-example"],
      successPattern: /deleted|removed/i,
      verbose: true,
    }),
    timeout
  );
});

// ============================================================================
// Tool calling with slice filtering
// ============================================================================

describe("Tool Calling — Slice Filtering", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "agent can only use read/list tools when slices are restricted",
    async () => {
      const result = await runAgentTest(
        `List all example items and get the first one by ID. Report its details.`,
        [],
        {
          serverEnv: {
            ...BASE_ENV,
            UMBRACO_INCLUDE_SLICES: "read,list",
          },
          useServerFiltering: true,
          verbosity: "verbose",
        }
      );

      const shortNames = result.availableTools.map(getShortToolName);

      // Read and list tools should be available and usable
      expect(shortNames).toContain("get-example");
      expect(shortNames).toContain("list-examples");

      // Mutation tools should not be available
      expect(shortNames).not.toContain("create-example");
      expect(shortNames).not.toContain("delete-example");

      // Agent should have successfully called tools
      const toolsCalled = result.toolCalls.map((tc) => getShortToolName(tc.name));
      expect(toolsCalled).toContain("list-examples");
      expect(result.success).toBe(true);
    },
    timeout
  );

  it(
    "agent uses only search tools when search slice is included",
    async () => {
      const result = await runAgentTest(
        `Search for example items containing "Sample" and report results.`,
        [],
        {
          serverEnv: {
            ...BASE_ENV,
            UMBRACO_INCLUDE_SLICES: "search",
          },
          useServerFiltering: true,
          verbosity: "verbose",
        }
      );

      const shortNames = result.availableTools.map(getShortToolName);
      expect(shortNames).toContain("search-examples");
      expect(shortNames).not.toContain("list-examples");
      expect(shortNames).not.toContain("create-example");

      const toolsCalled = result.toolCalls.map((tc) => getShortToolName(tc.name));
      expect(toolsCalled).toContain("search-examples");
    },
    timeout
  );
});

// ============================================================================
// Tool calling with collection filtering
// ============================================================================

describe("Tool Calling — Collection Filtering", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "agent only sees and uses tools from included collection",
    async () => {
      const result = await runAgentTest(
        `List all available items. Use whatever list tool you have.`,
        [],
        {
          serverEnv: {
            ...BASE_ENV,
            UMBRACO_INCLUDE_TOOL_COLLECTIONS: "example-2",
          },
          useServerFiltering: true,
          verbosity: "verbose",
        }
      );

      const shortNames = result.availableTools.map(getShortToolName);

      // Only example-2 collection tools
      expect(shortNames).toContain("get-widget");
      expect(shortNames).toContain("list-widgets");
      expect(shortNames).not.toContain("get-example");
      expect(shortNames).not.toContain("list-examples");

      // Agent should have used widget tools
      const toolsCalled = result.toolCalls.map((tc) => getShortToolName(tc.name));
      expect(toolsCalled).toContain("list-widgets");
    },
    timeout
  );
});

// ============================================================================
// Tool calling in dry-run mode
// ============================================================================

describe("Tool Calling — Dry-Run Mode", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "read tools return real data in dry-run mode",
    async () => {
      const result = await runAgentTest(
        `List all example items. How many are there? What are their names?`,
        ["list-examples"],
        {
          serverEnv: {
            ...BASE_ENV,
            UMBRACO_DRY_RUN: "true",
          },
          verbosity: "verbose",
        }
      );

      // List should work normally and return actual data
      const toolsCalled = result.toolCalls.map((tc) => getShortToolName(tc.name));
      expect(toolsCalled).toContain("list-examples");

      // Should report actual items (from mock store)
      expect(result.finalResult).toMatch(/sample item|3|three/i);
    },
    timeout
  );

  it(
    "mutation tools return dry-run preview, agent understands it",
    async () => {
      const result = await runAgentTest(
        `Create an example item named "Dry Run Item". Report exactly what happened — was it actually created or just previewed?`,
        ["create-example"],
        {
          serverEnv: {
            ...BASE_ENV,
            UMBRACO_DRY_RUN: "true",
          },
          verbosity: "verbose",
        }
      );

      const toolsCalled = result.toolCalls.map((tc) => getShortToolName(tc.name));
      expect(toolsCalled).toContain("create-example");

      // Agent should understand it was a preview
      expect(result.finalResult).toMatch(/dry.?run|preview|would|not.*actually|simulated|not.*created/i);
    },
    timeout
  );
});

// ============================================================================
// Tool calling in readonly mode
// ============================================================================

describe("Tool Calling — Readonly Mode", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "agent can read data but has no mutation tools in readonly mode",
    async () => {
      const result = await runAgentTest(
        `List all example items and tell me about each one.`,
        [],
        {
          serverEnv: {
            ...BASE_ENV,
            UMBRACO_READONLY: "true",
          },
          useServerFiltering: true,
          verbosity: "verbose",
        }
      );

      const shortNames = result.availableTools.map(getShortToolName);

      // Read tools work
      expect(shortNames).toContain("list-examples");
      expect(shortNames).toContain("get-example");

      // No mutation tools
      expect(shortNames).not.toContain("create-example");
      expect(shortNames).not.toContain("update-example");
      expect(shortNames).not.toContain("delete-example");

      // Agent should have listed items successfully
      const toolsCalled = result.toolCalls.map((tc) => getShortToolName(tc.name));
      expect(toolsCalled).toContain("list-examples");
      expect(result.finalResult).toMatch(/sample|item/i);
    },
    timeout
  );
});

// ============================================================================
// Multi-step workflows
// ============================================================================

describe("Tool Calling — Multi-Step Workflows", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "agent can do a full create-read-update-delete cycle",
    runScenarioTest({
      prompt: `Complete these steps in order:
1. Create an example item named "Workflow Test" with description "Multi-step test"
2. List items to find its ID
3. Update the item to change its name to "Workflow Complete"
4. Delete the item
Report each step.`,
      tools: ["create-example", "list-examples", "get-example", "update-example", "delete-example"],
      requiredTools: ["create-example", "update-example", "delete-example"],
      successPattern: /created|updated|deleted/i,
      verbose: true,
    }),
    timeout
  );

  it(
    "agent can work across two collections",
    async () => {
      const result = await runAgentTest(
        `List all example items and all widgets. How many items total across both collections?`,
        ["list-examples", "list-widgets"],
        {
          verbosity: "verbose",
        }
      );

      const toolsCalled = result.toolCalls.map((tc) => getShortToolName(tc.name));
      expect(toolsCalled).toContain("list-examples");
      expect(toolsCalled).toContain("list-widgets");
      expect(result.success).toBe(true);
    },
    timeout
  );
});
