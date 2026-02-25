/**
 * Eval Test Setup
 *
 * Configures the eval test framework for this MCP server.
 * This runs before any tests via setupFilesAfterEnv in jest.config.ts.
 */

import path from "path";
import { configureEvals, ClaudeModels } from "@umbraco-cms/mcp-server-sdk/evals";

// Configure the eval framework for this MCP server
configureEvals({
  // Path to the built MCP server
  mcpServerPath: path.resolve(process.cwd(), "dist/index.js"),

  // MCP server name (used in tool name prefixes like mcp__my-umbraco-mcp__tool-name)
  mcpServerName: "my-umbraco-mcp",

  // Environment variables for the MCP server
  // USE_MOCK_API=true uses the in-memory mock client for testing
  // Auth credentials are required even for mock mode (server validates config at startup)
  // DISABLE_MCP_CHAINING=true prevents attempting to connect to chained MCP servers
  serverEnv: {
    USE_MOCK_API: "true",
    DISABLE_MCP_CHAINING: "true",
    UMBRACO_CLIENT_ID: "test-client",
    UMBRACO_CLIENT_SECRET: "test-secret",
    UMBRACO_BASE_URL: "http://localhost:9999",
    // For real API testing, override these from environment:
    // UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID || "",
    // UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET || "",
    // UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL || "http://localhost:44391",
  },

  // Test defaults
  defaultModel: ClaudeModels.Haiku,
  defaultMaxTurns: 10,
  defaultMaxBudgetUsd: 0.25,
  defaultTimeoutMs: 60000,
});
