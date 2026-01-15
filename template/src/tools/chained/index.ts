/**
 * Chained Tools Collection
 *
 * EXAMPLE: Tools that call other MCP servers
 * ==========================================
 *
 * This collection demonstrates how local tools can call tools on chained
 * MCP servers using `mcpClientManager.callTool()`.
 *
 * WHY USE THIS PATTERN?
 * ---------------------
 * - Aggregate data from multiple MCP servers into unified responses
 * - Add business logic, validation, or caching around chained calls
 * - Create domain-specific tools that orchestrate lower-level operations
 * - Hide complexity of multi-server interactions from the AI agent
 *
 * SETUP REQUIREMENTS:
 * -------------------
 * 1. Configure chained servers in `src/config/mcp-servers.ts`
 * 2. Import `mcpClientManager` from `../../mcp-client.js`
 * 3. Call `mcpClientManager.callTool(serverName, toolName, args)`
 *
 * See `get-chained-info.ts` for a fully documented example.
 */

import { ToolCollectionExport } from "@umbraco-cms/mcp-toolkit";
import getChainedInfoTool from "./get-chained-info.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "chained",
    displayName: "Chained Tools",
    description:
      "Example tools demonstrating how to call tools on chained MCP servers",
  },
  tools: () => [getChainedInfoTool],
};

export default collection;
