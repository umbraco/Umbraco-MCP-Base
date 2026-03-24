/**
 * MCP Client Types
 *
 * Type definitions for MCP chaining - connecting to and calling other MCP servers.
 */

import type { ToolCollectionExport } from "../types/tool-collection.js";
import type { ToolModeDefinition } from "../types/tool-mode.js";

/**
 * Abstract connection to an MCP server.
 * Implemented by StdioConnection (child process) and InProcessConnection (direct handler calls).
 */
export interface McpConnection {
  listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }>;

  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }>;

  close(): Promise<void>;
}

/**
 * Configuration for connecting to an external MCP server via stdio.
 */
export interface McpStdioServerConfig {
  /**
   * Transport type. Optional for backward compatibility — defaults to "stdio".
   */
  transport?: "stdio";

  /**
   * Unique identifier and prefix for proxied tools.
   * Tools from this server will be exposed as `{name}:tool-name`.
   * @example "cms" → tools exposed as "cms--get-document"
   */
  name: string;

  /**
   * Command to spawn the MCP server.
   * @example "npx" or "node"
   */
  command: string;

  /**
   * Arguments for the command.
   * @example ["-y", "@anthropic/umbraco-developer-mcp"]
   */
  args?: string[];

  /**
   * Environment variables to pass to the MCP server.
   * These are merged with the current process.env.
   */
  env?: Record<string, string>;

  /**
   * Whether to proxy tools from this server to the parent client.
   * When true, tools are discovered and exposed with a prefix.
   * @default true
   */
  proxyTools?: boolean;
}

/**
 * Configuration for an in-process MCP connection.
 * Calls tool handlers directly without spawning a child process.
 * Suitable for environments where child_process is unavailable (e.g., Cloudflare Workers).
 */
export interface McpInProcessServerConfig {
  /**
   * Transport type. Required for in-process connections.
   */
  transport: "in-process";

  /**
   * Unique identifier and prefix for proxied tools.
   */
  name: string;

  /**
   * Tool collections to expose through this connection.
   */
  collections: ToolCollectionExport[];

  /**
   * User context passed to collection.tools(user).
   */
  user?: unknown;

  /**
   * Mode registry for filter expansion.
   */
  modeRegistry?: ToolModeDefinition[];

  /**
   * All valid mode names for validation.
   */
  allModeNames?: readonly string[];

  /**
   * All valid slice names for validation.
   */
  allSliceNames?: readonly string[];

  /**
   * Whether to proxy tools from this connection to the parent client.
   * @default true
   */
  proxyTools?: boolean;

  /**
   * Factory function that returns the API client for this server's tools.
   *
   * When provided, `configureApiClient` is temporarily swapped to this factory
   * before each tool handler call, then restored afterwards. This allows
   * in-process chained servers to use their own Orval-generated client
   * (with methods like `client.getCulture()`) without conflicting with the
   * host server's API client.
   *
   * @example
   * ```typescript
   * import { UmbracoManagementClient } from "@umbraco-cms/mcp-dev";
   *
   * manager.registerServer({
   *   transport: "in-process",
   *   name: "cms",
   *   collections,
   *   clientFactory: () => UmbracoManagementClient.getClient(),
   * });
   * ```
   */
  clientFactory?: () => unknown;
}

/**
 * Configuration for connecting to an MCP server.
 * Discriminated union — use `transport` to select the connection type.
 */
export type McpServerConfig = McpStdioServerConfig | McpInProcessServerConfig;

/**
 * Options for creating an MCP client manager.
 */
export interface McpClientOptions {
  /**
   * Tool/slice/mode filters to pass through to chained servers.
   * These filters are appended as CLI arguments when spawning stdio servers,
   * or applied directly for in-process connections.
   */
  filterConfig?: FilterConfig;
}

/**
 * Filter configuration for tool discovery.
 */
export interface FilterConfig {
  /** Specific tools to enable */
  tools?: string[];
  /** Tool collections to enable */
  toolCollections?: string[];
  /** Slices (operation types) to enable */
  slices?: string[];
  /** Slices (operation types) to exclude */
  excludeSlices?: string[];
  /** Modes (domain groupings) to enable */
  modes?: string[];
  /** When true, only include tools with readOnlyHint annotation */
  readOnly?: boolean;
}
