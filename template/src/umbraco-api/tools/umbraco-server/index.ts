/**
 * Umbraco Server Tool Collection
 *
 * Tools that call real Umbraco Management API endpoints.
 * Used to verify the full authentication chain works end-to-end.
 */

import { ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import getServerInfoTool from "./get/get-server-info.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "umbraco-server",
    displayName: "Umbraco Server",
    description: "Server information and status from the Umbraco Management API",
  },
  tools: () => [getServerInfoTool],
};

export default collection;
