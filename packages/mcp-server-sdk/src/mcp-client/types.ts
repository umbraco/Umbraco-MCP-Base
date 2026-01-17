/**
 * MCP Client Types
 *
 * Type definitions for MCP chaining - connecting to and calling other MCP servers.
 */

/**
 * Configuration for connecting to an external MCP server.
 */
export interface McpServerConfig {
  /**
   * Unique identifier and prefix for proxied tools.
   * Tools from this server will be exposed as `{name}:tool-name`.
   * @example "cms" → tools exposed as "cms:get-document"
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
 * Options for creating an MCP client manager.
 */
export interface McpClientOptions {
  /**
   * Tool/slice/mode filters to pass through to chained servers.
   * These filters are appended as CLI arguments when spawning the server.
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
  /** Modes (domain groupings) to enable */
  modes?: string[];
}
