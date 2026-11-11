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
import { isLoopbackUrl } from "../helpers/url.js";

/** How much of the child's stderr to keep for error messages. */
const STDERR_TAIL_BYTES = 4096;

/**
 * Build the env for a chained stdio child.
 *
 * The package's `configEnv` wins over the parent's env, except that a
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` it sets is dropped (with a warning) when
 * the child's effective UMBRACO_BASE_URL is not a loopback URL. The child's
 * own SDK refuses to start in that combination, so passing it on would only
 * break every chained call (umbraco/Umbraco-MCP-Base#449).
 *
 * Only the config's override is dropped: a value the operator set on the
 * parent's own env is theirs to own, and the child's refusal (with its stderr
 * surfaced by StdioConnection) names the cause.
 */
export function buildChildEnv(
  serverName: string,
  configEnv: Record<string, string> | undefined,
  parentEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const overrides = { ...configEnv };
  const baseUrl = overrides.UMBRACO_BASE_URL ?? parentEnv.UMBRACO_BASE_URL ?? "";
  if (overrides.NODE_TLS_REJECT_UNAUTHORIZED === "0" && !isLoopbackUrl(baseUrl)) {
    delete overrides.NODE_TLS_REJECT_UNAUTHORIZED;
    console.error(
      `[mcp-client] Chained server "${serverName}" sets NODE_TLS_REJECT_UNAUTHORIZED=0 ` +
        `but its UMBRACO_BASE_URL (${baseUrl || "unset"}) is not a local URL. ` +
        `Dropping it: TLS verification may only be disabled for a local instance.`,
    );
  }
  return { ...parentEnv, ...overrides } as Record<string, string>;
}

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
  private stderrTail = "";
  private closed = false;

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
      env: buildChildEnv(this.config.name, this.config.env),
      // Pipe stderr so a startup failure's reason can be surfaced in the
      // thrown error; it is still forwarded to the parent's stderr below.
      stderr: "pipe",
    });

    transport.stderr?.on("data", (chunk: Buffer | string) => {
      process.stderr.write(chunk);
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });
    this.client.onclose = () => {
      this.closed = true;
    };

    await this.withStderr(() => this.client.connect(transport));
  }

  // `context` is accepted for interface symmetry and ignored: nothing
  // request-scoped crosses the process boundary.
  async listTools(_context?: unknown): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }> {
    const result = await this.withStderr(() => this.client.listTools());
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
    const result = await this.withStderr(() =>
      this.client.request(
        { method: "tools/call", params: { name, arguments: args } },
        CallToolResultSchema,
      ),
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
   * Run a client operation; if it fails after the child has exited, append the
   * child's stderr tail so the caller sees why (e.g. a startup refusal) rather
   * than only "Connection closed". The error object is kept (so McpError codes
   * survive); only its message is extended.
   */
  private async withStderr<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (this.closed && error instanceof Error) {
        // Let any stderr still in flight through the pipe land first.
        await new Promise((resolve) => setImmediate(resolve));
        const tail = this.stderrTail.trim();
        if (tail && !error.message.includes(tail)) {
          error.message +=
            `\nChained server "${this.config.name}" exited. Its stderr (tail):\n${tail}`;
        }
      }
      throw error;
    }
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
