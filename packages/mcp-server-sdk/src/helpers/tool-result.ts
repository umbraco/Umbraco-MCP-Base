/**
 * Tool Result Helpers
 *
 * This module provides helpers for creating standardized MCP tool results
 * with proper typing for structured content.
 *
 * By default, results include both `structuredContent` and a JSON-stringified
 * `content` fallback for maximum client compatibility (per MCP spec guidance).
 *
 * Set `TOOL_STRUCTURED_RESULT=true` to return `structuredContent` only,
 * omitting the JSON duplication in `content`. Use this when your MCP client
 * is known to support `structuredContent` (e.g. Claude Code, Claude Desktop).
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624
 */

/**
 * Returns true when structured-only mode is enabled via env var.
 * In this mode, content is not populated with a JSON copy of structuredContent.
 */
function isStructuredOnly(): boolean {
  const envValue = typeof process !== "undefined" ? process.env?.TOOL_STRUCTURED_RESULT : undefined;
  return envValue === "true" || envValue === "1";
}

/**
 * Creates a properly typed success tool result with structured content.
 *
 * Default: both `structuredContent` and `content` (JSON stringified) are returned.
 * With `TOOL_STRUCTURED_RESULT=true`: only `structuredContent` is returned,
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
