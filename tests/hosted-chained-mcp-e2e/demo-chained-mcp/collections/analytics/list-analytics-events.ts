import type { ToolDefinition } from "@umbraco-cms/mcp-server-sdk";

const tool: ToolDefinition = {
  name: "list-analytics-events",
  description: "List recent analytics events",
  slices: ["list"],
  annotations: { readOnlyHint: true },
  handler: async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          items: [
            { event: "page_view", page: "/home", count: 450 },
            { event: "page_view", page: "/about", count: 120 },
            { event: "click", element: "cta-button", count: 85 },
          ],
          total: 3,
        }),
      },
    ],
  }),
};

export default tool;
