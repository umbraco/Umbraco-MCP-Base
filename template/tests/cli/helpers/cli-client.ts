/**
 * CLI Client Helper
 *
 * Spawns the built CLI binary as an MCP server and connects to it
 * via StdioClientTransport for programmatic testing.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "path";

/**
 * Options for creating a CLI test client.
 */
export interface CliClientOptions {
  /** Additional environment variables to set */
  env?: Record<string, string>;
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
  const projectRoot = resolve(import.meta.dirname, "../../..");
  const entryPoint = resolve(projectRoot, "dist/index.js");

  const transport = new StdioClientTransport({
    command: "node",
    args: [entryPoint],
    env: {
      ...process.env,
      USE_MOCK_API: "true",
      UMBRACO_CLIENT_ID: "test-client",
      UMBRACO_CLIENT_SECRET: "test-secret",
      UMBRACO_BASE_URL: "http://localhost:9999",
      ...options?.env,
    },
  });

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
  };
}
