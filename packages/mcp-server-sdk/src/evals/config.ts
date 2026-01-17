/**
 * Eval Test Configuration
 *
 * Centralized configuration for Agent SDK tests.
 * Configure these values for your MCP server before running tests.
 */

/**
 * Verbosity levels for test output:
 * - "quiet": Minimal output (just pass/fail per test, summary at end)
 * - "normal": Standard output with tools called, cost info
 * - "verbose": Full conversation trace with all messages
 */
export type VerbosityLevel = "quiet" | "normal" | "verbose";

/**
 * Configuration for the eval test framework.
 */
export interface EvalConfig {
  /** Path to the built MCP server entry point */
  mcpServerPath: string;
  /** Name of the MCP server (used in tool name prefixes) */
  mcpServerName: string;
  /** Environment variables to pass to the MCP server */
  serverEnv: Record<string, string>;
  /** Default model to use for tests */
  defaultModel: string;
  /** Default maximum conversation turns */
  defaultMaxTurns: number;
  /** Default maximum budget in USD */
  defaultMaxBudgetUsd: number;
  /** Default test timeout in milliseconds */
  defaultTimeoutMs: number;
  /** Default verbosity level */
  defaultVerbosity: VerbosityLevel;
}

// Default configuration (can be overridden by configureEvals)
let config: EvalConfig = {
  mcpServerPath: "dist/index.js",
  mcpServerName: "mcp-server",
  serverEnv: {},
  defaultModel: "claude-3-5-haiku-20241022",
  defaultMaxTurns: 15,
  defaultMaxBudgetUsd: 0.50,
  defaultTimeoutMs: 120000,
  defaultVerbosity: (process.env.E2E_VERBOSITY as VerbosityLevel) || "quiet",
};

/**
 * Configures the eval test framework.
 * Call this before running any tests.
 *
 * @param newConfig - Partial configuration to merge with defaults
 *
 * @example
 * ```typescript
 * import { configureEvals } from '@umbraco-cms/mcp-server-sdk/evals';
 * import path from 'path';
 *
 * configureEvals({
 *   mcpServerPath: path.resolve(process.cwd(), 'dist/index.js'),
 *   mcpServerName: 'umbraco-mcp',
 *   serverEnv: {
 *     UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID || '',
 *     UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET || '',
 *     UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL || 'http://localhost:56472',
 *   }
 * });
 * ```
 */
export function configureEvals(newConfig: Partial<EvalConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Gets the current eval configuration.
 */
export function getEvalConfig(): EvalConfig {
  return config;
}

// Accessor functions for convenience
export function getMcpServerPath(): string { return config.mcpServerPath; }
export function getMcpServerName(): string { return config.mcpServerName; }
export function getServerEnv(): Record<string, string> { return config.serverEnv; }
export function getDefaultModel(): string { return config.defaultModel; }
export function getDefaultMaxTurns(): number { return config.defaultMaxTurns; }
export function getDefaultMaxBudgetUsd(): number { return config.defaultMaxBudgetUsd; }
export function getDefaultTimeoutMs(): number { return config.defaultTimeoutMs; }
export function getDefaultVerbosity(): VerbosityLevel { return config.defaultVerbosity; }

/**
 * Gets tool list as comma-separated string for environment variables.
 */
export function getToolsString(tools: readonly string[]): string {
  return [...tools].join(",");
}

/**
 * Gets the effective verbosity level from options.
 */
export function getVerbosity(options?: { verbose?: boolean; verbosity?: VerbosityLevel }): VerbosityLevel {
  // Explicit verbosity takes precedence
  if (options?.verbosity) {
    return options.verbosity;
  }
  // Legacy verbose flag maps to "verbose"
  if (options?.verbose) {
    return "verbose";
  }
  return config.defaultVerbosity;
}
