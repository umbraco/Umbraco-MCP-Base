/**
 * Real Umbraco API tool — calls the server information endpoint via the SDK fetch client.
 * Used to prove in-process MCP chaining works with real API calls.
 */
import { z } from "zod";
import {
  UmbracoManagementClient,
  type ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";

const tool: ToolDefinition<Record<string, never>> = {
  name: "get-server-version",
  description: "Gets the Umbraco server version (real API call)",
  slices: ["read"],
  annotations: { readOnlyHint: true },
  inputSchema: {},
  handler: async () => {
    const data = await UmbracoManagementClient<{ version: string }>({
      url: "/umbraco/management/api/v1/server/information",
      method: "GET",
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(data) }],
    };
  },
};

export default tool;
