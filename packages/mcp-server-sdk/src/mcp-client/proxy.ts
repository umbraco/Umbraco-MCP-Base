/**
 * MCP Tool Proxy
 *
 * Discovers and proxies tools from chained MCP servers,
 * exposing them to the parent client with a prefix.
 */

import type { McpClientManager } from "./manager.js";

/**
 * Represents a tool that has been discovered from a chained MCP server
 * and is ready to be proxied to the parent client.
 */
export interface ProxiedTool {
  /** Original tool definition from the chained server */
  originalTool: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  };

  /** Prefixed name for the parent client (e.g., "cms:get-document") */
  prefixedName: string;

  /** Server name for routing calls */
  serverName: string;
}

/**
 * Discovers tools from all registered MCP servers that have proxyTools enabled.
 * Returns an array of ProxiedTool definitions ready to be registered.
 *
 * @param manager - The MCP client manager with registered servers
 * @returns Array of discovered tools with prefixed names
 *
 * @example
 * ```typescript
 * const proxiedTools = await discoverProxiedTools(mcpClientManager);
 * // Returns: [{ prefixedName: "cms:get-document", serverName: "cms", ... }]
 * ```
 */
export async function discoverProxiedTools(
  manager: McpClientManager
): Promise<ProxiedTool[]> {
  const proxiedTools: ProxiedTool[] = [];

  for (const [serverName, config] of manager.getConfigs()) {
    // Skip servers that don't want their tools proxied
    if (config.proxyTools === false) {
      continue;
    }

    try {
      const { tools } = await manager.listTools(serverName);

      for (const tool of tools) {
        proxiedTools.push({
          originalTool: tool,
          prefixedName: `${serverName}:${tool.name}`,
          serverName,
        });
      }
    } catch (error) {
      // Log but don't fail - server might be unavailable
      console.error(`Failed to discover tools from ${serverName}:`, error);
    }
  }

  return proxiedTools;
}

/**
 * Checks if a tool name is a proxied tool (contains the server prefix).
 *
 * @param toolName - The tool name to check
 * @returns True if the tool name contains a colon (prefix separator)
 */
export function isProxiedToolName(toolName: string): boolean {
  return toolName.includes(":");
}

/**
 * Parses a proxied tool name into server name and original tool name.
 *
 * @param prefixedName - The prefixed tool name (e.g., "cms:get-document")
 * @returns Object with serverName and toolName
 *
 * @example
 * ```typescript
 * parseProxiedToolName("cms:get-document")
 * // Returns: { serverName: "cms", toolName: "get-document" }
 * ```
 */
export function parseProxiedToolName(prefixedName: string): {
  serverName: string;
  toolName: string;
} {
  const colonIndex = prefixedName.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid proxied tool name: ${prefixedName}`);
  }

  return {
    serverName: prefixedName.substring(0, colonIndex),
    toolName: prefixedName.substring(colonIndex + 1),
  };
}

/**
 * Creates a handler function that forwards tool calls to a chained server.
 *
 * @param manager - The MCP client manager
 * @param serverName - The server to forward calls to
 * @param originalToolName - The original tool name on the chained server
 * @returns An async handler function
 */
export function createProxyHandler(
  manager: McpClientManager,
  serverName: string,
  originalToolName: string
): (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
}> {
  return async (args: Record<string, unknown>) => {
    return manager.callTool(serverName, originalToolName, args);
  };
}

/**
 * Converts proxied tools into tool definitions for registration.
 *
 * @param proxiedTools - Array of discovered proxied tools
 * @returns Array of tool definitions ready for MCP registration
 */
export function proxiedToolsToDefinitions(
  proxiedTools: ProxiedTool[]
): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return proxiedTools.map((pt) => ({
    name: pt.prefixedName,
    description: `[Proxied from ${pt.serverName}] ${pt.originalTool.description || "No description"}`,
    inputSchema: pt.originalTool.inputSchema || {
      type: "object",
      properties: {},
    },
  }));
}
