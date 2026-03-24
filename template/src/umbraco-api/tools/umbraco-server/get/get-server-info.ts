/**
 * Get Server Information Tool
 *
 * Calls the real Umbraco Management API to fetch server version and runtime info.
 * Uses the custom transport layer (fetch with Bearer token) that's set up by
 * the hosted MCP server during per-request initialization.
 *
 * This tool proves the full authentication chain works:
 * OAuth flow → Umbraco token → Management API call → response.
 */

import {
  withStandardDecorators,
  createToolResult,
  UmbracoManagementClient,
  CAPTURE_RAW_HTTP_RESPONSE,
  type ToolDefinition,
  type HttpResponse,
} from "@umbraco-cms/mcp-server-sdk";

interface ServerInfo {
  version: string;
  assemblyVersion: string;
}

const getServerInfoTool: ToolDefinition = {
  name: "get-server-info",
  description:
    "Gets Umbraco server information including version and runtime details.",
  slices: ["read"],
  annotations: {
    readOnlyHint: true,
  },
  handler: async () => {
    // Call the real Umbraco Management API endpoint.
    // UmbracoManagementClient routes through the custom transport (fetch with
    // the user's Bearer token) that was configured during server init.
    // CAPTURE_RAW_HTTP_RESPONSE returns HttpResponse<T> at runtime,
    // but the generic signature returns T — cast to access .data.
    const response = await UmbracoManagementClient<ServerInfo>(
      { url: "/umbraco/management/api/v1/server/information", method: "GET" },
      CAPTURE_RAW_HTTP_RESPONSE,
    ) as unknown as HttpResponse<ServerInfo>;

    return createToolResult(response.data, true, [
      { type: "text", text: JSON.stringify(response.data, null, 2) },
    ]);
  },
};

export default withStandardDecorators(getServerInfoTool);
