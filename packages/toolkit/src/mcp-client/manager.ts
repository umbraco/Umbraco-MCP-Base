/**
 * MCP Client Manager
 *
 * Manages connections to external MCP servers for chaining.
 * Supports both internal delegation (tools calling other MCP tools)
 * and tool proxying (exposing chained tools to the parent client).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, McpClientOptions, FilterConfig } from "./types.js";

/**
 * Manages connections to external MCP servers.
 *
 * @example
 * ```typescript
 * const manager = createMcpClientManager({
 *   filterConfig: { slices: ["read", "list"] }
 * });
 *
 * manager.registerServer({
 *   name: "cms",
 *   command: "npx",
 *   args: ["-y", "@anthropic/umbraco-developer-mcp"],
 *   env: { UMBRACO_BASE_URL: "http://localhost:44391" }
 * });
 *
 * // Internal delegation
 * const result = await manager.callTool("cms", "get-document", { id: "..." });
 *
 * // List tools for proxying
 * const { tools } = await manager.listTools("cms");
 * ```
 */
export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private configs: Map<string, McpServerConfig> = new Map();
  private filterConfig: FilterConfig | undefined;

  constructor(options?: McpClientOptions) {
    this.filterConfig = options?.filterConfig;
  }

  /**
   * Register an MCP server configuration.
   * The server is not connected until first use (lazy connection).
   */
  registerServer(config: McpServerConfig): void {
    this.configs.set(config.name, config);
  }

  /**
   * Build command arguments with filter passthrough.
   * Appends --tools, --slices, etc. to pass filters to the chained server.
   */
  private buildArgs(config: McpServerConfig): string[] {
    const args = [...(config.args || [])];

    // Pass through filters to chained server
    if (this.filterConfig?.tools?.length) {
      args.push("--tools", this.filterConfig.tools.join(","));
    }
    if (this.filterConfig?.toolCollections?.length) {
      args.push("--tool-collections", this.filterConfig.toolCollections.join(","));
    }
    if (this.filterConfig?.slices?.length) {
      args.push("--slices", this.filterConfig.slices.join(","));
    }
    if (this.filterConfig?.modes?.length) {
      args.push("--modes", this.filterConfig.modes.join(","));
    }

    return args;
  }

  /**
   * Connect to an MCP server.
   * Returns existing connection if already connected.
   */
  async connect(serverName: string): Promise<Client> {
    // Return existing connection
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!;
    }

    const config = this.configs.get(serverName);
    if (!config) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    const client = new Client(
      { name: "mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new StdioClientTransport({
      command: config.command,
      args: this.buildArgs(config),
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    await client.connect(transport);
    this.clients.set(serverName, client);
    return client;
  }

  /**
   * Call a tool on a chained MCP server.
   * Used for internal delegation from local tools.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text?: string }> }> {
    const client = await this.connect(serverName);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result as { content: Array<{ type: string; text?: string }> };
  }

  /**
   * List tools available on a chained MCP server.
   * Used for tool discovery and proxying.
   */
  async listTools(serverName: string): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }> {
    const client = await this.connect(serverName);
    const result = await client.listTools();
    return result as {
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
  }

  /**
   * Get all registered server configurations.
   * Used by the proxy module to discover which servers to proxy.
   */
  getConfigs(): Map<string, McpServerConfig> {
    return this.configs;
  }

  /**
   * Check if a server is registered.
   */
  hasServer(serverName: string): boolean {
    return this.configs.has(serverName);
  }

  /**
   * Check if connected to a server.
   */
  isConnected(serverName: string): boolean {
    return this.clients.has(serverName);
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (client) {
      await client.close();
      this.clients.delete(serverName);
    }
  }

  /**
   * Disconnect from all servers.
   * Should be called on shutdown.
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];
    for (const [name] of this.clients) {
      disconnectPromises.push(this.disconnect(name));
    }
    await Promise.all(disconnectPromises);
  }
}

/**
 * Create a new MCP client manager.
 *
 * @param options - Configuration options including filter passthrough
 * @returns A new McpClientManager instance
 */
export function createMcpClientManager(options?: McpClientOptions): McpClientManager {
  return new McpClientManager(options);
}
