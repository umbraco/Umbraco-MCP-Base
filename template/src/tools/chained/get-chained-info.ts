/**
 * Get Chained Server Info Tool
 *
 * EXAMPLE: Calling tools on chained MCP servers from local tools
 * ================================================================
 *
 * This tool demonstrates how to call tools on a chained MCP server from within
 * a local tool. This is useful when you want to:
 *
 * 1. Aggregate data from multiple MCP servers into a single response
 * 2. Add business logic or validation before/after calling chained tools
 * 3. Combine local data with data from chained servers
 * 4. Create higher-level abstractions over lower-level MCP tools
 *
 * HOW IT WORKS:
 * -------------
 * 1. Import `mcpClientManager` from `../../mcp-client.js`
 * 2. Call `mcpClientManager.callTool(serverName, toolName, args)`
 *    - serverName: The name defined in mcp-servers.ts (e.g., "cms")
 *    - toolName: The tool name on the chained server (e.g., "get-server-info")
 *    - args: The arguments to pass to the tool
 * 3. The result contains a `content` array with the tool's response
 *
 * CHAINED SERVER CONFIGURATION:
 * -----------------------------
 * Chained servers are configured in `src/config/mcp-servers.ts`. Each server
 * has a `name` that you use when calling `mcpClientManager.callTool()`.
 *
 * For example, if mcp-servers.ts has:
 * ```typescript
 * { name: "cms", command: "npx", args: [...], proxyTools: true }
 * ```
 *
 * Then you can call any tool on that server with:
 * ```typescript
 * const result = await mcpClientManager.callTool("cms", "tool-name", { arg: "value" });
 * ```
 *
 * EXTRACTING RESULTS:
 * -------------------
 * MCP tool results can return data in two ways:
 *
 * 1. Structured content (preferred): `result.structuredContent`
 *    - Direct access to typed data, no parsing needed
 *    - Available when the tool defines an outputSchema
 *
 * 2. Text content (legacy): `result.content[].text`
 *    - Requires finding text content and JSON.parse()
 *    - Used by older tools or simple string responses
 *
 * ```typescript
 * // Preferred: Use structured content
 * const data = result.structuredContent;
 *
 * // Fallback: Parse text content
 * const textContent = result.content?.find(c => c.type === "text");
 * const data = textContent ? JSON.parse(textContent.text) : null;
 * ```
 */

import { z } from "zod";
import {
  withStandardDecorators,
  createToolResult,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";

// Import the MCP client manager singleton
// This is configured in mcp-client.ts and registers servers from mcp-servers.ts
import { mcpClientManager } from "../../mcp-client.js";

const inputSchema = {
  includeTimestamp: z
    .boolean()
    .optional()
    .describe("Whether to include the current timestamp in the response"),
};

const outputSchema = z.object({
  source: z.string().describe("Indicates how the data was retrieved"),
  chainedResponse: z.unknown().describe("The response from the chained server"),
  timestamp: z.string().optional().describe("When the request was made"),
});

const getChainedInfoTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "get-chained-info",
  description:
    "Gets server info by delegating to a chained MCP server. Demonstrates how local tools can call tools on chained servers.",
  inputSchema,
  outputSchema,
  slices: ["read"],
  annotations: {
    readOnlyHint: true,
  },
  handler: async ({ includeTimestamp }) => {
    // =========================================================================
    // STEP 1: Call a tool on the chained MCP server
    // =========================================================================
    // mcpClientManager.callTool() sends a request to the chained server.
    // - "cms" is the server name from mcp-servers.ts
    // - "get-server-info" is the tool name on that server
    // - {} is the arguments object (this tool takes no arguments)
    const result = await mcpClientManager.callTool(
      "cms", // Server name (defined in mcp-servers.ts)
      "get-server-info", // Tool name on the chained server
      {} // Arguments to pass to the tool
    );

    // =========================================================================
    // STEP 2: Extract the response using structured content
    // =========================================================================
    // Tools that define outputSchema return data in structuredContent.
    // This is the preferred way to access typed data from tool results.
    //
    // For tools without outputSchema, fall back to parsing text content:
    // const textContent = result.content?.find(c => c.type === "text");
    // const data = textContent ? JSON.parse(textContent.text) : null;
    const chainedResponse = result.structuredContent;

    // =========================================================================
    // STEP 3: Return combined/enriched data
    // =========================================================================
    // Here we combine the chained response with local data (source, timestamp).
    // In a real scenario, you might:
    // - Add validation
    // - Combine with data from other sources
    // - Transform the response format
    // - Add caching
    return createToolResult({
      source: "chained-via-mcpClientManager",
      chainedResponse,
      ...(includeTimestamp ? { timestamp: new Date().toISOString() } : {}),
    });
  },
};

export default withStandardDecorators(getChainedInfoTool);
