/**
 * Stdio MCP Connection
 *
 * Connects to an MCP server by spawning a child process.
 * Uses @modelcontextprotocol/sdk's Client and StdioClientTransport.
 *
 * This module is dynamically imported — it is never loaded in environments
 * where node:child_process is unavailable (e.g., Cloudflare Workers).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpConnection, McpStdioServerConfig, FilterConfig } from "./types.js";

export class StdioConnection implements McpConnection {
  private client: Client;

  constructor(
    private config: McpStdioServerConfig,
    private filterConfig?: FilterConfig,
  ) {
    this.client = new Client(
      { name: "mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.buildArgs(),
      env: { ...process.env, ...this.config.env } as Record<string, string>,
    });

    await this.client.connect(transport);
  }

  async listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }> {
    const result = await this.client.listTools();
    return result as {
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    const result = await this.client.callTool({ name, arguments: args });
    return result as {
      content: Array<{ type: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * Build command arguments with filter passthrough.
   * Appends --tools, --slices, etc. to pass filters to the chained server.
   */
  private buildArgs(): string[] {
    const args = [...(this.config.args || [])];

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
}
