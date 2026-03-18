import type { ToolDefinition } from "@umbraco-cms/mcp-server-sdk";

const tool: ToolDefinition = {
  name: "get-analytics-summary",
  description: "Get analytics summary for the current period",
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          period: "2026-01",
          pageViews: 12500,
          uniqueVisitors: 3200,
          bounceRate: 0.42,
        }),
      },
    ],
  }),
};

export default tool;
