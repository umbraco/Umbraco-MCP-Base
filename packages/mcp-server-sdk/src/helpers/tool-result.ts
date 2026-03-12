/**
 * Tool Result Helpers
 *
 * This module provides helpers for creating standardized MCP tool results
 * with proper typing for structured content.
 *
 * By default, results include both `structuredContent` and a JSON-stringified
 * `content` fallback for maximum client compatibility (per MCP spec guidance).
 *
 * Set `DISABLE_OUTPUT_COMPATIBILITY_MODE=true` (env var or
 * --disable-output-compatibility-mode CLI flag) to disable compatibility mode
 * and return `structuredContent` only, omitting the JSON duplication in `content`.
 * Use this when your MCP client is known to support `structuredContent`
 * (e.g. Claude Code, Claude Desktop).
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624
 */

/**
 * Module-level flag for structured-only mode.
 * Set via configureToolResultMode() during server startup, or falls back to
 * reading the DISABLE_OUTPUT_COMPATIBILITY_MODE env var directly.
 */
let _structuredOnly: boolean | null = null;

/**
 * Configures the tool result mode. Call this once at server startup
 * after resolving the config via getServerConfig().
 *
 * @param structuredOnly - When true, content is not populated with a JSON
 *   copy of structuredContent. When false (default), both fields are populated.
 */
export function configureToolResultMode(structuredOnly: boolean): void {
  _structuredOnly = structuredOnly;
}

/**
 * Returns true when structured-only mode is enabled.
 * Checks the configured value first, then falls back to env var for
 * environments where getServerConfig() is not used (e.g. Workers).
 */
function isStructuredOnly(): boolean {
  if (_structuredOnly !== null) {
    return _structuredOnly;
  }
  // Fallback: read env var directly (for cases where configureToolResultMode
  // hasn't been called, e.g. hosted Workers or tests)
  const envValue = typeof process !== "undefined" ? process.env?.DISABLE_OUTPUT_COMPATIBILITY_MODE : undefined;
  return envValue === "true" || envValue === "1";
}

/**
 * Creates a properly typed success tool result with structured content.
 *
 * Default: both `structuredContent` and `content` (JSON stringified) are returned.
 * With `DISABLE_OUTPUT_COMPATIBILITY_MODE=true`: only `structuredContent` is returned,
 * with an empty `content` array.
 *
 * @param structuredContent - The structured data matching the outputSchema
 * @param includeStructured - Whether to include structuredContent (default: true)
 * @param content - Optional explicit content array (bypasses auto-formatting)
 *
 * @returns A tool result that satisfies ToolCallback's type constraints
 */
export function createToolResult<T = unknown>(
  structuredContent?: T,
  includeStructured: boolean = true,
  content?: Array<{ type: "text"; text: string }>
): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { [x: string]: unknown };
} {
  if (content) {
    return {
      content,
      ...(includeStructured && structuredContent !== undefined && {
        structuredContent: structuredContent as { [x: string]: unknown },
      }),
    };
  }

  if (structuredContent !== undefined && includeStructured) {
    return {
      content: isStructuredOnly()
        ? []
        : [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
      structuredContent: structuredContent as { [x: string]: unknown },
    };
  }

  return {
    content: [{ type: "text" as const, text: "" }],
  };
}

/**
 * Creates a tool result for error responses with structured content.
 * API errors are typically ProblemDetails objects, so we use structured output.
 *
 * @param errorData - The error data (typically ProblemDetails from API)
 * @returns A tool result with isError flag set to true
 */
export function createToolResultError<T = unknown>(
  errorData: T
): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { [x: string]: unknown };
  isError: boolean;
} {
  return {
    ...createToolResult(errorData),
    isError: true,
  };
}
