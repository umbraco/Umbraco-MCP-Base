/**
 * Create Widget Tool
 *
 * Simple mock tool for testing collection filtering.
 */

import { z } from "zod";
import {
  withStandardDecorators,
  createToolResult,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";
import { v4 as uuid } from "uuid";

const inputSchema = {
  name: z.string().describe("The widget name"),
  type: z.enum(["basic", "advanced"]).optional().default("basic").describe("The widget type"),
};

const outputSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  created: z.boolean(),
});

const createWidgetTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "create-widget",
  description: "Creates a new widget.",
  inputSchema,
  outputSchema,
  slices: ["create"],
  annotations: {
    readOnlyHint: false,
  },
  handler: async ({ name, type }) => {
    // Mock response for testing
    return createToolResult({
      id: uuid(),
      name,
      type: type ?? "basic",
      created: true,
    });
  },
};

export default withStandardDecorators(createWidgetTool);
