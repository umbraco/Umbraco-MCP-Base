/**
 * MCP Server Chain Configuration
 *
 * Configure external MCP servers that this server can connect to and proxy.
 * Tools from these servers will be available to the parent client with a prefix.
 *
 * @example
 * When configured with name: "cms", tools from that server appear as:
 * - cms:get-document
 * - cms:list-documents
 * - etc.
 */

import type { McpServerConfig } from "@umbraco-cms/mcp-toolkit";

/**
 * External MCP servers to chain to.
 *
 * Each server configured here will:
 * 1. Be available for internal delegation (tools calling mcpClientManager.callTool())
 * 2. Have its tools proxied to the parent client (if proxyTools is true)
 * 3. Receive the same filter configuration (tools, slices, modes) as this server
 */
export const mcpServers: McpServerConfig[] = [
  // Umbraco CMS Developer MCP - provides access to core CMS functionality
  {
    name: "cms",
    command: "npx",
    args: ["-y", "@umbraco-cms/mcp-dev@17"],
    env: {
      UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL || "http://localhost:44391",
      UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID || "",
      UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET || "",
    },
    proxyTools: true,
  },

  // Add more chained MCP servers here as needed
  // {
  //   name: "another-mcp",
  //   command: "npx",
  //   args: ["-y", "@scope/another-mcp"],
  //   env: { ... },
  //   proxyTools: true,
  // },
];
