import type { ToolDefinition } from "@umbraco-cms/mcp-server-sdk";

const tool: ToolDefinition = {
  name: "list-notifications",
  description: "List all notifications",
  slices: ["list"],
  annotations: { readOnlyHint: true },
  handler: async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          items: [
            { id: "n1", title: "Welcome", read: true },
            { id: "n2", title: "Update Available", read: false },
          ],
          total: 2,
        }),
      },
    ],
  }),
};

export default tool;
