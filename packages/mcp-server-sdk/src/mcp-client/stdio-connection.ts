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
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpConnection, McpStdioServerConfig, FilterConfig } from "./types.js";

/** List filters and the SDK CLI flag each is passed to a chained server as. */
const LIST_FILTER_FLAGS = [
  ["tools", "--umbraco-include-tools"],
  ["toolCollections", "--umbraco-include-tool-collections"],
  ["slices", "--umbraco-include-slices"],
  ["excludeSlices", "--umbraco-exclude-slices"],
  ["modes", "--umbraco-tool-modes"],
] as const satisfies ReadonlyArray<readonly [keyof FilterConfig, string]>;

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

  // `context` is accepted for interface symmetry and ignored: nothing
  // request-scoped crosses the process boundary.
  async listTools(_context?: unknown): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
    }>;
  }> {
    const result = await this.client.listTools();
    return result as {
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
      }>;
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    _context?: unknown,
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    // Raw tools/call rather than client.callTool(): the v1.x Client validates
    // structuredContent against the tool's outputSchema even on isError
    // results, throwing -32602 and discarding the chained server's real error
    // (servers on older SDKs still send errors as structuredContent). Callers
    // handle isError themselves; extractChainedResult reads either format.
    // See umbraco/Umbraco-MCP-Base#343 and typescript-sdk#2748.
    //
    // v2: the v2 Client (@modelcontextprotocol/client) skips output
    // validation on isError results, so when we migrate to it this can
    // revert to `this.client.callTool({ name, arguments: args })`.
    const result = await this.client.request(
      { method: "tools/call", params: { name, arguments: args } },
      CallToolResultSchema,
    );
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
   * Build command arguments with filter passthrough, using the SDK's own
   * `--umbraco-*` config flags so a chained server built on the SDK applies
   * them as it would its own command line.
   */
  private buildArgs(): string[] {
    const args = [...(this.config.args || [])];
    const filters = this.filterConfig ?? {};

    for (const [key, flag] of LIST_FILTER_FLAGS) {
      const values = filters[key];
      if (values?.length) args.push(flag, values.join(","));
    }
    if (filters.readOnly) {
      args.push("--umbraco-readonly");
    }

    return args;
  }
}
