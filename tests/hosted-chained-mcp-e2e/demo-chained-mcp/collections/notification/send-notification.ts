import { z } from "zod";
import type { ToolDefinition } from "@umbraco-cms/mcp-server-sdk";

const tool: ToolDefinition<{ title: z.ZodString; message: z.ZodString }> = {
  name: "send-notification",
  description: "Send a new notification",
  slices: ["create"],
  annotations: { readOnlyHint: false },
  inputSchema: {
    title: z.string().describe("Notification title"),
    message: z.string().describe("Notification message"),
  },
  handler: async (args) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          id: "n-new",
          title: args.title,
          message: args.message,
          sent: true,
          createdAt: "2026-01-15T12:00:00Z",
        }),
      },
    ],
  }),
};

export default tool;
