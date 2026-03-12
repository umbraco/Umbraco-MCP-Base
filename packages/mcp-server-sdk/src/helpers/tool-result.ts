/**
 * Tool Result Helpers
 *
 * This module provides helpers for creating standardized MCP tool results
 * with proper typing for structured content.
 *
 * Results always use `structuredContent` with a minimal `content` placeholder.
 * This satisfies the MCP SDK's outputSchema validation while keeping token
 * usage low. Clients that support structuredContent read the real data;
 * clients that only read content see a pointer to it.
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624
 */

/**
 * Creates a properly typed success tool result with structured content.
 *
 * When structuredContent is provided, it is always included in the result
 * and content contains a minimal placeholder to satisfy the MCP protocol.
 *
 * @param structuredContent - The structured data matching the outputSchema
 * @param includeStructured - Whether to include structuredContent (default: true)
 * @param content - Optional explicit content array (bypasses placeholder)
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
      content: [{ type: "text" as const, text: "See structuredContent" }],
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
