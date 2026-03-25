/**
 * MCP Client Manager
 *
 * Manages connections to MCP servers for chaining.
 * Supports both stdio (child process) and in-process transports.
 */

import type {
  McpServerConfig,
  McpClientOptions,
  FilterConfig,
  McpConnection,
} from "./types.js";

/**
 * Manages connections to MCP servers.
 *
 * @example
 * ```typescript
 * const manager = createMcpClientManager({
 *   filterConfig: { slices: ["read", "list"] }
 * });
 *
 * // Stdio transport (spawns child process)
 * manager.registerServer({
 *   name: "cms",
 *   command: "npx",
 *   args: ["-y", "@anthropic/umbraco-developer-mcp"],
 *   env: { UMBRACO_BASE_URL: "http://localhost:44391" }
 * });
 *
 * // In-process transport (direct handler calls)
 * manager.registerServer({
 *   transport: "in-process",
 *   name: "dev",
 *   collections: devCollections,
 * });
 *
 * // Same API regardless of transport
 * const result = await manager.callTool("cms", "get-document", { id: "..." });
 * const { tools } = await manager.listTools("dev");
 * ```
 */
export class McpClientManager {
  private connections: Map<string, McpConnection> = new Map();
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
   * Connect to an MCP server.
   * Returns existing connection if already connected.
   */
  async connect(serverName: string): Promise<McpConnection> {
    if (this.connections.has(serverName)) {
      return this.connections.get(serverName)!;
    }

    const config = this.configs.get(serverName);
    if (!config) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    let connection: McpConnection;

    if (config.transport === "in-process") {
      const { InProcessConnection } = await import("./in-process-connection.js");
      connection = new InProcessConnection(config, this.filterConfig);
    } else {
      const { StdioConnection } = await import("./stdio-connection.js");
      const stdioConn = new StdioConnection(config, this.filterConfig);
      await stdioConn.connect();
      connection = stdioConn;
    }

    this.connections.set(serverName, connection);
    return connection;
  }

  /**
   * Call a tool on a chained MCP server.
   *
   * @returns Tool result with optional structuredContent (when tool has outputSchema)
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    const connection = await this.connect(serverName);
    return connection.callTool(toolName, args);
  }

  /**
   * List tools available on a chained MCP server.
   */
  async listTools(serverName: string): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }> {
    const connection = await this.connect(serverName);
    return connection.listTools();
  }

  /**
   * Get all registered server configurations.
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
    return this.connections.has(serverName);
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (connection) {
      await connection.close();
      this.connections.delete(serverName);
    }
  }

  /**
   * Disconnect from all servers.
   * Should be called on shutdown.
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];
    for (const [name] of this.connections) {
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
export function createMcpClientManager(
  options?: McpClientOptions,
): McpClientManager {
  return new McpClientManager(options);
}
