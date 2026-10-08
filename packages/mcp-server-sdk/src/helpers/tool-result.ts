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
 * Error results are the exception: they always carry their payload as JSON
 * text content and never set `structuredContent` (see createToolResultError).
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

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { [x: string]: unknown };
};

/**
 * Creates a tool result with structured content and compatibility fallback.
 *
 * @param data - The structured data matching the outputSchema. Omit for void operations.
 * @returns A tool result with both structuredContent and content (unless compatibility mode is disabled)
 */
export function createToolResult<T = unknown>(data?: T): ToolResult {
  if (data === undefined) {
    return { content: [{ type: "text" as const, text: "" }] };
  }

  return {
    content: isStructuredOnly()
      ? []
      : [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data as { [x: string]: unknown },
  };
}

/**
 * Creates a tool result for error responses.
 *
 * The error data is returned as JSON in a text content block only — never as
 * `structuredContent`, and regardless of compatibility mode. Error payloads
 * (typically ProblemDetails) don't match the tool's outputSchema, and the
 * v1.x MCP SDK `Client` validates `structuredContent` against it even when
 * `isError` is set, throwing `-32602` and discarding the real error. Text
 * content is never validated, and it's what the spec's error examples use.
 *
 * @param errorData - The error data (typically ProblemDetails from API).
 *   Strings are sent as-is; anything else is JSON-stringified.
 * @returns A tool result with isError flag set to true
 *
 * @see https://github.com/umbraco/Umbraco-MCP-Base/issues/343
 * @see https://github.com/modelcontextprotocol/typescript-sdk/issues/2748
 */
export function createToolResultError<T = unknown>(
  errorData: T
): ToolResult & { isError: boolean } {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof errorData === "string" ? errorData : JSON.stringify(errorData),
      },
    ],
    isError: true,
  };
}
