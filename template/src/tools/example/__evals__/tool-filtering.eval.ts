/**
 * Tool Filtering Eval Tests
 *
 * Tests that verify the MCP server correctly filters tools based on
 * environment variable configuration:
 * - UMBRACO_INCLUDE_SLICES / UMBRACO_EXCLUDE_SLICES
 * - UMBRACO_INCLUDE_TOOL_COLLECTIONS / UMBRACO_EXCLUDE_TOOL_COLLECTIONS
 * - UMBRACO_TOOL_MODES
 * - UMBRACO_INCLUDE_TOOLS / UMBRACO_EXCLUDE_TOOLS
 *
 * These tests use `useServerFiltering: true` to let the server handle
 * tool filtering rather than the test harness.
 */

import "./setup.js"; // Must be first - configures eval framework
import { describe, it, expect } from "@jest/globals";
import {
  runAgentTest,
  getShortToolName,
  getDefaultTimeoutMs,
  setupConsoleMock,
} from "@umbraco-cms/mcp-toolkit/evals";

/**
 * Base env vars required for all filtering tests.
 * The server requires auth credentials even when using mock API.
 * DISABLE_MCP_CHAINING prevents attempting to connect to chained MCP servers.
 */
const BASE_ENV = {
  USE_MOCK_API: "true",
  DISABLE_MCP_CHAINING: "true",
  UMBRACO_CLIENT_ID: "test-client",
  UMBRACO_CLIENT_SECRET: "test-secret",
  UMBRACO_BASE_URL: "http://localhost:9999",
};

describe("Tool Filtering", () => {
  setupConsoleMock();

  const timeout = getDefaultTimeoutMs();

  describe("Slice Filtering", () => {
    it(
      "should only expose read tools when UMBRACO_INCLUDE_SLICES=read",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [], // Empty tools array - let server filtering decide
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_INCLUDE_SLICES: "read",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Read slice tools should be available
        expect(shortNames).toContain("get-example");

        // Non-read tools should NOT be available
        expect(shortNames).not.toContain("create-example");
        expect(shortNames).not.toContain("update-example");
        expect(shortNames).not.toContain("delete-example");
      },
      timeout
    );

    it(
      "should only expose read and list tools when UMBRACO_INCLUDE_SLICES=read,list",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_INCLUDE_SLICES: "read,list",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Read and list slice tools should be available
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");

        // Create/update/delete should NOT be available
        expect(shortNames).not.toContain("create-example");
        expect(shortNames).not.toContain("update-example");
        expect(shortNames).not.toContain("delete-example");
      },
      timeout
    );

    it(
      "should exclude delete tools when UMBRACO_EXCLUDE_SLICES=delete",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_EXCLUDE_SLICES: "delete",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // All non-delete tools should be available
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");
        expect(shortNames).toContain("create-example");
        expect(shortNames).toContain("update-example");

        // Delete tools should NOT be available
        expect(shortNames).not.toContain("delete-example");
      },
      timeout
    );
  });

  describe("Collection Filtering", () => {
    it(
      "should only expose example collection when UMBRACO_INCLUDE_TOOL_COLLECTIONS=example",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_INCLUDE_TOOL_COLLECTIONS: "example",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Example collection tools should be available
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");
        expect(shortNames).toContain("create-example");
        expect(shortNames).toContain("update-example");
        expect(shortNames).toContain("delete-example");
      },
      timeout
    );

    it(
      "should exclude example collection when UMBRACO_EXCLUDE_TOOL_COLLECTIONS=example",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_EXCLUDE_TOOL_COLLECTIONS: "example",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Example collection tools should NOT be available
        expect(shortNames).not.toContain("get-example");
        expect(shortNames).not.toContain("list-examples");
        expect(shortNames).not.toContain("create-example");
      },
      timeout
    );
  });

  describe("Mode Filtering", () => {
    it(
      "should expose example collection when UMBRACO_TOOL_MODES=example",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_TOOL_MODES: "example",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Example mode maps to example collection
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");
        expect(shortNames).toContain("create-example");
      },
      timeout
    );
  });

  describe("Individual Tool Filtering", () => {
    it(
      "should only expose specific tools when UMBRACO_INCLUDE_TOOLS is set",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_INCLUDE_TOOLS: "get-example,list-examples",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Only specified tools should be available
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");

        // Other tools should NOT be available
        expect(shortNames).not.toContain("create-example");
        expect(shortNames).not.toContain("update-example");
        expect(shortNames).not.toContain("delete-example");
      },
      timeout
    );

    it(
      "should exclude specific tools when UMBRACO_EXCLUDE_TOOLS is set",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_EXCLUDE_TOOLS: "delete-example,update-example",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Non-excluded tools should be available
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");
        expect(shortNames).toContain("create-example");

        // Excluded tools should NOT be available
        expect(shortNames).not.toContain("delete-example");
        expect(shortNames).not.toContain("update-example");
      },
      timeout
    );
  });

  describe("Combined Filtering", () => {
    it(
      "should combine slice include with tool exclude",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: {
              ...BASE_ENV,
              UMBRACO_INCLUDE_SLICES: "read,list,create",
              UMBRACO_EXCLUDE_TOOLS: "create-example",
            },
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // Read and list tools should be available
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");

        // create-example excluded even though create slice is included
        expect(shortNames).not.toContain("create-example");

        // Update/delete not in included slices
        expect(shortNames).not.toContain("update-example");
        expect(shortNames).not.toContain("delete-example");
      },
      timeout
    );
  });

  describe("No Filtering (All Tools)", () => {
    it(
      "should expose all tools when no filtering env vars are set",
      async () => {
        const result = await runAgentTest(
          "List all available tools you can use.",
          [],
          {
            serverEnv: BASE_ENV,
            useServerFiltering: true,
            maxTurns: 1,
            verbosity: "quiet",
          }
        );

        const shortNames = result.availableTools.map(getShortToolName);

        // All example tools should be available
        expect(shortNames).toContain("get-example");
        expect(shortNames).toContain("list-examples");
        expect(shortNames).toContain("search-examples");
        expect(shortNames).toContain("create-example");
        expect(shortNames).toContain("update-example");
        expect(shortNames).toContain("delete-example");
      },
      timeout
    );
  });
});
