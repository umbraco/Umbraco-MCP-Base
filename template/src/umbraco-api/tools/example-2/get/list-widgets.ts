/**
 * List Widgets Tool
 *
 * Simple mock tool for testing collection filtering.
 */

import { z } from "zod";
import {
  withStandardDecorators,
  createToolResult,
  ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";

const inputSchema = {
  skip: z.number().optional().default(0).describe("Number of items to skip"),
  take: z.number().optional().default(10).describe("Number of items to take"),
};

const outputSchema = z.object({
  total: z.number(),
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  })),
});

const listWidgetsTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "list-widgets",
  description: "Lists all widgets with pagination.",
  inputSchema,
  outputSchema,
  slices: ["list"],
  annotations: {
    readOnlyHint: true,
  },
  handler: async () => {
    // Mock response for testing
    return createToolResult({
      total: 2,
      items: [
        { id: "widget-1", name: "Widget One", type: "basic" },
        { id: "widget-2", name: "Widget Two", type: "advanced" },
      ],
    });
  },
};

export default withStandardDecorators(listWidgetsTool);
