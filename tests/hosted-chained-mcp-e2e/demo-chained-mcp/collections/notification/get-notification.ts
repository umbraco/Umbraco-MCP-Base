import { z } from "zod";
import type { ToolDefinition } from "@umbraco-cms/mcp-server-sdk";

const tool: ToolDefinition<{ id: z.ZodString }> = {
  name: "get-notification",
  description: "Get a notification by ID",
  slices: ["read"],
  annotations: { readOnlyHint: true },
  inputSchema: { id: z.string().describe("Notification ID") },
  handler: async (args) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          id: args.id,
          title: "Test Notification",
          message: "This is a mock notification",
          read: false,
          createdAt: "2026-01-15T10:00:00Z",
        }),
      },
    ],
  }),
};

export default tool;
