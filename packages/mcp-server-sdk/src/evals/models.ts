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
  /** Claude 3.5 Haiku - Fast and cost-effective (latest Haiku) */
  Haiku: "claude-3-5-haiku-20241022",

  /** Claude 4.5 Sonnet - Balanced performance and cost */
  Sonnet: "claude-sonnet-4-5-20250514",

  /** Claude 4.5 Opus - Most capable model */
  Opus: "claude-opus-4-5-20251101",
} as const;

