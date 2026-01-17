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

import path from "path";
import { fileURLToPath } from "url";
import type { McpServerConfig } from "@umbraco-cms/mcp-server-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Use mock MCP server for testing chaining functionality.
 * Set USE_MOCK_MCP_CHAIN=true to use a simple mock server instead of real Umbraco.
 */
const useMockChain = process.env.USE_MOCK_MCP_CHAIN === "true";

/**
 * Mock MCP server configuration for testing.
 * Uses a simple server that returns mock tools and responses.
 * Path resolves from dist/ to src/ since tsx runs TypeScript directly.
 * Note: tsup bundles into dist/index.js so __dirname is dist/, not dist/config/
 */
const mockCmsServer: McpServerConfig = {
  name: "cms",
  command: "npx",
  args: [
    "tsx",
    // From dist/index.js, go to ../src/testing/
    path.resolve(__dirname, "../src/testing/mock-mcp-server.ts"),
  ],
  proxyTools: true,
};

/**
 * Real Umbraco CMS MCP server configuration.
 */
const realCmsServer: McpServerConfig = {
  name: "cms",
  command: "npx",
  args: ["-y", "@umbraco-cms/mcp-dev@17"],
  env: {
    UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL || "http://localhost:44391",
    UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID || "",
    UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET || "",
  },
  proxyTools: true,
};

/**
 * External MCP servers to chain to.
 *
 * Each server configured here will:
 * 1. Be available for internal delegation (tools calling mcpClientManager.callTool())
 * 2. Have its tools proxied to the parent client (if proxyTools is true)
 * 3. Receive the same filter configuration (tools, slices, modes) as this server
 */
export const mcpServers: McpServerConfig[] = [
  // Use mock server for testing, real server otherwise
  useMockChain ? mockCmsServer : realCmsServer,

  // Add more chained MCP servers here as needed
  // {
  //   name: "another-mcp",
  //   command: "npx",
  //   args: ["-y", "@scope/another-mcp"],
  //   env: { ... },
  //   proxyTools: true,
  // },
];
