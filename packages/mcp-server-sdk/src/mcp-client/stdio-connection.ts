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
import type { Readable } from "node:stream";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpConnection, McpStdioServerConfig, FilterConfig } from "./types.js";
import { isLoopbackUrl } from "../helpers/url.js";

/** How much of the child's stderr to keep for the operator log on exit. */
const STDERR_TAIL_BYTES = 4096;

const BASE_URL_FLAG = "--umbraco-base-url";

/** The last `--umbraco-base-url` value in `args` (`--flag value` or `--flag=value`). */
function baseUrlFromArgs(args: readonly string[]): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === BASE_URL_FLAG && i + 1 < args.length) value = args[++i];
    else if (args[i].startsWith(`${BASE_URL_FLAG}=`)) value = args[i].slice(BASE_URL_FLAG.length + 1);
  }
  return value;
}

/** Whether `args` passes an explicit `--env <file>` / `--env=<file>`. */
function hasEnvFileArg(args: readonly string[]): boolean {
  return args.some((arg, i) => (arg === "--env" && i + 1 < args.length) || arg.startsWith("--env="));
}

/**
 * Build the env for a chained stdio child.
 *
 * The package's `configEnv` wins over the parent's env, except that a
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` it sets is dropped (with a warning) when
 * the child's base URL is known and is not a loopback URL. The child's own SDK
 * refuses to start in that combination, so passing it on would only break
 * every chained call (umbraco/Umbraco-MCP-Base#449).
 *
 * The base URL is known here only when `args` has `--umbraco-base-url` (the
 * child's config ranks the CLI flag first), or, failing that, from
 * UMBRACO_BASE_URL in `configEnv` then the parent's env. An explicit
 * `--env <file>` in `args` is loaded by the child with override, so a
 * UMBRACO_BASE_URL inside it would beat the env this sees: with `--env` and
 * no `--umbraco-base-url`, the base URL is treated as unknown. When it is
 * unknown (also when the child loads it from its own default `.env`, or is not
 * an Umbraco server at all) the flag is passed on: the child's own guard is
 * the authority, and dropping it could break a local self-signed setup.
 *
 * Only the config's override is dropped: a value the operator set on the
 * parent's own env is theirs to own and still reaches the child, which then
 * refuses to start and names the cause in its stderr. The warning says so.
 */
export function buildChildEnv(
  serverName: string,
  configEnv: Record<string, string> | undefined,
  parentEnv: NodeJS.ProcessEnv = process.env,
  args: readonly string[] = [],
): Record<string, string> {
  const overrides = { ...configEnv };
  const argBaseUrl = baseUrlFromArgs(args);
  const baseUrl =
    argBaseUrl ||
    (hasEnvFileArg(args) ? undefined : overrides.UMBRACO_BASE_URL || parentEnv.UMBRACO_BASE_URL);
  if (overrides.NODE_TLS_REJECT_UNAUTHORIZED === "0" && baseUrl && !isLoopbackUrl(baseUrl)) {
    delete overrides.NODE_TLS_REJECT_UNAUTHORIZED;
    const prefix =
      `[mcp-client] Chained server "${serverName}" sets NODE_TLS_REJECT_UNAUTHORIZED=0 ` +
      `but its base URL (${baseUrl}) is not a local URL. `;
    console.error(
      parentEnv.NODE_TLS_REJECT_UNAUTHORIZED === "0"
        ? prefix +
            `This process's own env also sets NODE_TLS_REJECT_UNAUTHORIZED=0, so the child ` +
            `inherits it and will refuse to start against that URL. Unset it for this process, ` +
            `or trust the server's certificate instead (e.g. NODE_EXTRA_CA_CERTS).`
        : prefix + `Dropping it: TLS verification may only be disabled for a local instance.`,
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
  private exitLogged = false;

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
      env: buildChildEnv(this.config.name, this.config.env, process.env, this.config.args),
      // Pipe stderr so its tail can be logged when the child exits; it is
      // still forwarded to the parent's stderr below.
      stderr: "pipe",
    });

    // Decode as UTF-8 so a multibyte character split across chunks stays
    // whole. Typed as Stream, it is a PassThrough when stderr is "pipe".
    (transport.stderr as Readable | null)?.setEncoding?.("utf8");
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      process.stderr.write(chunk);
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });
    this.client.onclose = () => {
      this.closed = true;
    };

    await this.withExitNotice(() => this.client.connect(transport));
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
    const result = await this.withExitNotice(() => this.client.listTools());
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
    const result = await this.withExitNotice(() =>
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
   * Run a client operation; if it fails after the child has exited, say so.
   *
   * The child's stderr tail goes to the operator log (the parent's stderr)
   * only, once, under a line naming the server. The thrown error gets a fixed
   * pointer and never the child's output: errors from callTool (and from a
   * connect it retries) reach the MCP client as tool results, so stderr there
   * would hand the agent untrusted text that may hold URLs, paths or secrets.
   * The error object is kept (so McpError codes survive); only its message is
   * extended.
   */
  private async withExitNotice<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (this.closed && error instanceof Error) {
        if (!this.exitLogged) {
          this.exitLogged = true;
          // Best effort: let stderr still in flight through the pipe land first.
          await new Promise((resolve) => setImmediate(resolve));
          const tail = this.stderrTail.trim();
          console.error(
            `[mcp-client] Chained server "${this.config.name}" exited.` +
              (tail ? ` Its stderr (tail):\n${tail}` : " It wrote nothing to stderr."),
          );
        }
        // The SDK rejects every pending request with one shared error object,
        // so only extend it once.
        const pointer = `Chained server "${this.config.name}" exited. See the MCP server's logs for its stderr.`;
        if (!error.message.includes(pointer)) error.message += `\n${pointer}`;
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
