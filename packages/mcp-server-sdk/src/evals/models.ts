/**
 * Claude Model Constants
 *
 * Pre-defined model identifiers for use in eval tests.
 * Use these instead of hardcoding model strings.
 *
 * @example
 * ```typescript
 * import { ClaudeModels } from "@umbraco-cms/mcp-server-sdk/evals";
 *
 * configureEvals({
 *   defaultModel: ClaudeModels.Haiku,
 * });
 * ```
 */

/**
 * Claude model identifiers for eval tests.
 */
export const ClaudeModels = {
  /** Claude 4.5 Haiku - Fast and cost-effective */
  Haiku: "claude-haiku-4-5-20251001",

  /** Claude 4.5 Sonnet - Balanced performance and cost */
  Sonnet: "claude-sonnet-4-5-20250929",

  /** Claude Opus 4.6 - Most capable model */
  Opus: "claude-opus-4-6",
} as const;

