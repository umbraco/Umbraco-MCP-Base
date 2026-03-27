/**
 * Runtime Eval Setup
 *
 * Configures the SDK eval framework for runtime tests that call tools
 * via MCP protocol. Uses the template as the test harness.
 */

import * as path from "path";
import { configureEvals, ClaudeModels } from "@umbraco-cms/mcp-server-sdk/evals";

configureEvals({
  mcpServerPath: path.resolve(process.cwd(), "template/dist/index.js"),
  mcpServerName: "my-umbraco-mcp",
  serverEnv: {
    USE_MOCK_API: "true",
    DISABLE_MCP_CHAINING: "true",
    UMBRACO_CLIENT_ID: "test-client",
    UMBRACO_CLIENT_SECRET: "test-secret",
    UMBRACO_BASE_URL: "http://localhost:9999",
  },
  defaultModel: ClaudeModels.Haiku,
  defaultMaxTurns: 10,
  defaultMaxBudgetUsd: 0.25,
  defaultTimeoutMs: 60000,
});
