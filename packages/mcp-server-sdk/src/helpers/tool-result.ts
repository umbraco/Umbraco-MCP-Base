/**
 * Tool Result Helpers
 *
 * This module provides helpers for creating standardized MCP tool results
 * with proper typing for structured content.
 *
 * By default, results use `content` only (JSON stringified) for maximum client
 * compatibility. When the connected client is known to support `structuredContent`
 * (e.g. Claude Desktop, Claude Code), the module auto-upgrades to use
 * `structuredContent` instead.
 *
 * Override with env var: TOOL_STRUCTURED_RESULT=true|false
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624
 */

/** Clients known to properly handle structuredContent */
const STRUCTURED_CONTENT_CLIENTS = [
  "claude-ai",       // Claude Desktop
  "claude-code",     // Claude Code CLI
  "claudecode",      // Claude Code (alternate)
];

/** Module-level flag controlling whether to use structuredContent */
let useStructuredContent: boolean | undefined;

/**
 * Configure whether tool results use `structuredContent` or `content`.
 *
 * - `true`: Results use `structuredContent` only (for clients that support it)
 * - `false`: Results use `content` only with JSON stringified data (universal compatibility)
 *
 * Called automatically by `detectToolResultMode()`, or set manually.
 * Can also be set via `TOOL_STRUCTURED_RESULT` env var (takes precedence).
 */
export function setToolResultStructured(enabled: boolean): void {
  useStructuredContent = enabled;
}

/**
 * Returns the current structured content mode.
 */
export function getToolResultStructured(): boolean {
  return resolveMode();
}

/**
 * Auto-detect the tool result mode from the MCP client info.
 * Call this after the MCP server connects to a transport.
 *
 * @param clientName - The `clientInfo.name` from the MCP initialize handshake
 *
 * @example
 * ```typescript
 * // After server.connect(transport)
 * const clientInfo = server.server.getClientVersion();
 * if (clientInfo) {
 *   detectToolResultMode(clientInfo.name);
 * }
 * ```
 */
export function detectToolResultMode(clientName: string): void {
  const normalised = clientName.toLowerCase().trim();
  const isStructuredClient = STRUCTURED_CONTENT_CLIENTS.some(
    (name) => normalised === name || normalised.includes(name),
  );
  useStructuredContent = isStructuredClient;
  console.error(
    `[tool-result] MCP client: "${clientName}" → ${isStructuredClient ? "structuredContent" : "content"} mode`,
  );
}

/**
 * Resolve the effective mode. Priority:
 * 1. TOOL_STRUCTURED_RESULT env var
 * 2. Auto-detected / manually set value
 * 3. Default: false (content only)
 */
function resolveMode(): boolean {
  const envValue = typeof process !== "undefined" ? process.env?.TOOL_STRUCTURED_RESULT : undefined;
  if (envValue !== undefined) {
    return envValue === "true" || envValue === "1";
  }
  return useStructuredContent ?? false;
}

/**
 * Creates a properly typed success tool result.
 *
 * When structured mode is enabled (auto-detected or via env var), the result
 * uses `structuredContent`. Otherwise, JSON is stringified into `content` for
 * client compatibility.
 *
 * @param structuredContent - The structured data matching the outputSchema
 * @param includeStructured - Whether to include structuredContent when in structured mode (default: true)
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
  // Explicit content always wins
  if (content) {
    return {
      content,
      ...(includeStructured && resolveMode() && structuredContent !== undefined && {
        structuredContent: structuredContent as { [x: string]: unknown },
      }),
    };
  }

  const structured = resolveMode();

  if (structuredContent !== undefined && includeStructured) {
    if (structured) {
      // Structured mode: structuredContent with minimal content placeholder
      return {
        content: [{ type: "text" as const, text: "See structuredContent" }],
        structuredContent: structuredContent as { [x: string]: unknown },
      };
    } else {
      // Compatible mode: both fields — structuredContent for SDK validation,
      // JSON stringified in content for clients that only read content
      return {
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
        structuredContent: structuredContent as { [x: string]: unknown },
      };
    }
  }

  // No structuredContent provided
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
