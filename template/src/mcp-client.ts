/**
 * MCP Client Manager
 *
 * Singleton for calling tools on chained MCP servers from local tools.
 * =====================================================================
 *
 * This module creates and exports the `mcpClientManager` which allows your
 * tools to call tools on other MCP servers configured in `mcp-servers.ts`.
 *
 * WHY IS THIS A SEPARATE FILE?
 * ----------------------------
 * To avoid circular dependencies. Tools import from this file, and this file
 * imports from mcp-servers.ts (not index.ts which imports tool collections).
 *
 * USAGE IN TOOLS:
 * ---------------
 * ```typescript
 * import { mcpClientManager } from "../../mcp-client.js";
 *
 * // Call a tool on the "cms" server (defined in mcp-servers.ts)
 * const result = await mcpClientManager.callTool("cms", "get-document", { id: "..." });
 *
 * // Extract structured content (preferred - when tool has outputSchema)
 * const data = result.structuredContent;
 *
 * // Or extract text content (legacy fallback)
 * const textContent = result.content?.find(c => c.type === "text");
 * const data = textContent ? JSON.parse(textContent.text) : null;
 * ```
 *
 * AVAILABLE METHODS:
 * ------------------
 * - callTool(serverName, toolName, args) - Call a tool on a chained server
 * - listTools(serverName) - List available tools on a chained server
 * - connect(serverName) - Explicitly connect to a server (usually automatic)
 * - isConnected(serverName) - Check if a server is connected
 * - hasServer(serverName) - Check if a server is registered
 *
 * See `src/tools/chained/get-chained-info.ts` for a complete example.
 */

import { createMcpClientManager } from "@umbraco-cms/mcp-server-sdk";
import { mcpServers } from "./config/mcp-servers.js";

export const mcpClientManager = createMcpClientManager({
  // Pass through any filter configuration to chained servers
  // filterConfig: { tools: [], slices: [], modes: [] },
});

// Register all configured MCP servers from mcp-servers.ts
// These become available via mcpClientManager.callTool(serverName, ...)
for (const config of mcpServers) {
  mcpClientManager.registerServer(config);
}
