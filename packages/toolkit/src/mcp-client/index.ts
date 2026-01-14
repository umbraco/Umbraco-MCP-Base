/**
 * MCP Client Module
 *
 * Enables MCP servers to chain to other MCP servers, supporting:
 * - Internal delegation: Tools calling other MCP tools programmatically
 * - Tool proxying: Exposing chained server tools to the parent client
 * - Filter passthrough: Applying the same tool/slice filters to chained servers
 *
 * @example
 * ```typescript
 * import {
 *   createMcpClientManager,
 *   discoverProxiedTools,
 *   type McpServerConfig
 * } from "@umbraco-cms/mcp-toolkit";
 *
 * // Create manager with filter passthrough
 * const manager = createMcpClientManager({
 *   filterConfig: { slices: ["read", "list"] }
 * });
 *
 * // Register a chained server
 * manager.registerServer({
 *   name: "cms",
 *   command: "npx",
 *   args: ["-y", "@anthropic/umbraco-developer-mcp"],
 *   proxyTools: true
 * });
 *
 * // Internal delegation
 * const result = await manager.callTool("cms", "get-document", { id: "..." });
 *
 * // Discover tools for proxying
 * const proxiedTools = await discoverProxiedTools(manager);
 * ```
 */

// Types
export type {
  McpServerConfig,
  McpClientOptions,
  FilterConfig,
} from "./types.js";

// Manager
export {
  McpClientManager,
  createMcpClientManager,
} from "./manager.js";

// Proxy utilities
export {
  discoverProxiedTools,
  isProxiedToolName,
  parseProxiedToolName,
  createProxyHandler,
  proxiedToolsToDefinitions,
  type ProxiedTool,
} from "./proxy.js";
