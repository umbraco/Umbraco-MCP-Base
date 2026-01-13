/**
 * Eval Test Helpers
 *
 * Central export for all eval test utilities.
 *
 * Usage:
 * ```typescript
 * import {
 *   configureEvals,
 *   runScenarioTest,
 *   setupConsoleMock
 * } from "@umbraco-cms/mcp-toolkit/evals";
 *
 * // Configure before running tests
 * configureEvals({
 *   mcpServerPath: 'dist/index.js',
 *   mcpServerName: 'my-mcp',
 *   serverEnv: {
 *     MY_API_KEY: process.env.MY_API_KEY || ''
 *   }
 * });
 * ```
 */

// Configuration
export {
  configureEvals,
  getEvalConfig,
  getMcpServerPath,
  getMcpServerName,
  getServerEnv,
  getDefaultModel,
  getDefaultMaxTurns,
  getDefaultMaxBudgetUsd,
  getDefaultTimeoutMs,
  getDefaultVerbosity,
  getToolsString,
  getVerbosity,
  type VerbosityLevel,
  type EvalConfig,
} from "./config.js";

// Types
export type {
  AgentTestResult,
  ToolCall,
  AgentTestOptions,
  ToolVerificationResult,
  TestScenario
} from "./types.js";

// Agent runner
export {
  runAgentTest,
  getShortToolName,
  getFullToolName,
  formatToolCalls,
  logTestResult
} from "./agent-runner.js";

// Verification helpers
export {
  verifyRequiredToolCalls,
  verifySuccessMessage,
  verifyMcpConnection,
  verifyToolsAvailable,
  verifyToolCalledWithParams,
  getToolCalls,
  assertTestPassed
} from "./verification.js";

// Scenario runner (high-level test creation)
export {
  runScenarioTest,
  setupConsoleMock
} from "./scenario-runner.js";

// Model constants
export { ClaudeModels } from "./models.js";
