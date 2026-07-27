/**
 * CLI Client Helper
 *
 * Spawns the built CLI binary as an MCP server and connects to it
 * via StdioClientTransport for programmatic testing.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Options for creating a CLI test client.
 */
export interface CliClientOptions {
  /** Additional environment variables to set */
  env?: Record<string, string>;
  /**
   * Pipe the child process's stderr instead of inheriting it, so tests can
   * assert on server-side console.error output (e.g. the version-check
   * warning) without it polluting the test runner's own stderr silently.
   */
  captureStderr?: boolean;
}

/**
 * Test client wrapping an MCP client connected to the CLI binary.
 */
export interface CliTestClient {
  /** List all available tools */
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  /** Call a tool by name with arguments */
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** Close the connection and clean up */
  close(): Promise<void>;
  /** The server's `instructions` string sent during `initialize`, if any */
  getInstructions(): string | undefined;
  /** Accumulated stderr text captured so far (only populated when `captureStderr` is set) */
  getStderr(): string;
}

/**
 * Create a test client that spawns the built CLI binary
 * and connects via stdio MCP transport.
 *
 * Requires:
 * - The project to be built (npm run build)
 * - USE_MOCK_API=true for MSW mock server (no real Umbraco needed)
 */
export async function createCliTestClient(options?: CliClientOptions): Promise<CliTestClient> {
  const entryPoint = resolve(__dirname, "../../../../template/dist/index.js");

  // `JEST_WORKER_ID` is set in *this* process (the Jest test runner) and, via
  // the `...process.env` spread below, would otherwise leak into the spawned
  // child. The template's mock-mode check is
  // `USE_MOCK_API === "true" && !JEST_WORKER_ID` (see
  // `template/src/umbraco-api/api/client.ts`), so an inherited
  // `JEST_WORKER_ID` silently disables mock mode and sends the child's API
  // client at a real network call instead of the in-memory mock store — strip
  // it so `USE_MOCK_API=true` behaves the way this helper's own doc comment
  // promises.
  const { JEST_WORKER_ID: _jestWorkerId, ...parentEnv } = process.env;

  const transport = new StdioClientTransport({
    command: "node",
    args: [entryPoint],
    env: {
      ...parentEnv,
      USE_MOCK_API: "true",
      UMBRACO_CLIENT_ID: "test-client",
      UMBRACO_CLIENT_SECRET: "test-secret",
      UMBRACO_BASE_URL: "http://localhost:9999",
      ...options?.env,
    },
    stderr: options?.captureStderr ? "pipe" : "inherit",
  });

  let stderrBuffer = "";
  if (options?.captureStderr) {
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });
  }

  const client = new Client({
    name: "cli-test-client",
    version: "1.0.0",
  });

  await client.connect(transport);

  return {
    async listTools() {
      const result = await client.listTools();
      return result;
    },

    async callTool(name: string, args?: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      return result as CallToolResult;
    },

    async close() {
      await client.close();
    },

    getInstructions() {
      return client.getInstructions();
    },

    getStderr() {
      return stderrBuffer;
    },
  };
}
