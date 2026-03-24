import type { ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import getAnalyticsSummary from "./get-analytics-summary.js";
import listAnalyticsEvents from "./list-analytics-events.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "analytics",
    displayName: "Analytics",
    description: "Analytics and reporting tools",
  },
  tools: () => [getAnalyticsSummary, listAnalyticsEvents],
};

export default collection;
