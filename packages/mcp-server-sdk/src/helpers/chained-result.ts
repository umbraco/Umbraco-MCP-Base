/**
 * Chained Result Extraction
 *
 * When calling tools on a chained MCP server via mcpClientManager.callTool(),
 * the result may contain structured content (when the tool defines outputSchema)
 * or JSON-stringified text content (legacy fallback).
 *
 * This helper normalises both formats into a plain object, so tool handlers
 * don't need to care which format the chained server returns.
 *
 * @example
 * ```typescript
 * import { extractChainedResult } from "@umbraco-cms/mcp-server-sdk";
 *
 * const result = await mcpClientManager.callTool("cms", "get-document-by-id", { id });
 * if (result.isError) return createToolResultError(result);
 *
 * const doc = extractChainedResult(result);
 * // doc is now a plain object regardless of whether the chained server
 * // returned structuredContent or text content
 * ```
 */

/**
 * Extract the data from a chained MCP tool call result.
 *
 * Prefers `structuredContent` (available when the chained tool defines
 * outputSchema and the MCP SDK is >= 1.28.0). Falls back to parsing
 * the first text content block as JSON.
 *
 * Returns `undefined` if no data can be extracted.
 *
 * @param result - The raw result from mcpClientManager.callTool()
 * @returns The extracted data as a plain object, or undefined
 */
export function extractChainedResult(result: {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}): any {
  // Prefer structured content (typed, no parsing needed)
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  // Fallback: parse JSON from text content
  const textContent = result.content?.find(
    (c: { type: string }) => c.type === "text"
  );
  if (textContent?.text) {
    try {
      return JSON.parse(textContent.text);
    } catch {
      return textContent.text;
    }
  }

  return undefined;
}
