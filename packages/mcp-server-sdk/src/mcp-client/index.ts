/**
 * MCP Client Module
 *
 * Enables MCP servers to chain to other MCP servers, supporting:
 * - Internal delegation: Tools calling other MCP tools programmatically
 * - Tool proxying: Exposing chained server tools to the parent client
 * - Filter passthrough: Applying the same tool/slice filters to chained servers
 * - Multi-transport: stdio (child process) and in-process (direct handler calls)
 *
 * @example
 * ```typescript
 * import {
 *   createMcpClientManager,
 *   discoverProxiedTools,
 *   InProcessConnection,
 *   type McpServerConfig,
 *   type McpConnection,
 * } from "@umbraco-cms/mcp-server-sdk";
 *
 * // Create manager with filter passthrough
 * const manager = createMcpClientManager({
 *   filterConfig: { slices: ["read", "list"] }
 * });
 *
 * // Register a chained server (stdio)
 * manager.registerServer({
 *   name: "cms",
 *   command: "npx",
 *   args: ["-y", "@anthropic/umbraco-developer-mcp"],
 *   proxyTools: true
 * });
 *
 * // Register an in-process server (no child process)
 * manager.registerServer({
 *   transport: "in-process",
 *   name: "dev",
 *   collections: devCollections,
 * });
 *
 * // Same API regardless of transport
 * const result = await manager.callTool("cms", "get-document", { id: "..." });
 * const proxiedTools = await discoverProxiedTools(manager);
 * ```
 */

// Types
export type {
  McpServerConfig,
  McpStdioServerConfig,
  McpInProcessServerConfig,
  McpClientOptions,
  FilterConfig,
  McpConnection,
} from "./types.js";

// Manager
export {
  McpClientManager,
  createMcpClientManager,
} from "./manager.js";

// Connections (in-process is safe to import anywhere; stdio uses dynamic import)
export { InProcessConnection } from "./in-process-connection.js";

// Proxy utilities
export {
  discoverProxiedTools,
  isProxiedToolName,
  parseProxiedToolName,
  createProxyHandler,
  proxiedToolsToDefinitions,
  type ProxiedTool,
} from "./proxy.js";
