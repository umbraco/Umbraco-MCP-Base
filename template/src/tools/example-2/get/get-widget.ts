/**
 * Get Widget Tool
 *
 * Simple mock tool for testing collection filtering.
 */

import { z } from "zod";
import {
  withStandardDecorators,
  createToolResult,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";

const inputSchema = {
  id: z.uuid().describe("The widget ID"),
};

const outputSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

const getWidgetTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "get-widget",
  description: "Gets a widget by ID.",
  inputSchema,
  outputSchema,
  slices: ["read"],
  annotations: {
    readOnlyHint: true,
  },
  handler: async ({ id }) => {
    // Mock response for testing
    return createToolResult({
      id,
      name: "Test Widget",
      type: "basic",
    });
  },
};

export default withStandardDecorators(getWidgetTool);
