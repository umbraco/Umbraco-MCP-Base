/**
 * Eval Test Setup
 *
 * Configures the eval test framework for this MCP server.
 * This file is imported by all eval test files.
 */

import path from "path";
import { configureEvals } from "@umbraco-cms/mcp-toolkit/evals";

// Configure the eval framework for this MCP server
configureEvals({
  // Path to the built MCP server
  mcpServerPath: path.resolve(process.cwd(), "dist/index.js"),

  // MCP server name (used in tool name prefixes like mcp__my-umbraco-mcp__tool-name)
  mcpServerName: "my-umbraco-mcp",

  // Environment variables for the MCP server
  // USE_MOCK_API=true uses the in-memory mock client for testing
  serverEnv: {
    USE_MOCK_API: "true",
    // For real API testing, set these from environment:
    // UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID || "",
    // UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET || "",
    // UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL || "http://localhost:44391",
  },

  // Test defaults
  defaultModel: "claude-3-5-haiku-20241022",
  defaultMaxTurns: 10,
  defaultMaxBudgetUsd: 0.25,
  defaultTimeoutMs: 60000,
});
