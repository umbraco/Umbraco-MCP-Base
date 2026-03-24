import type { ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import getServerVersion from "./get-server-version.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "umbraco",
    displayName: "Umbraco API",
    description: "Tools that make real Umbraco API calls via fetch",
  },
  tools: () => [getServerVersion],
};

export default collection;
