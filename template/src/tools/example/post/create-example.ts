/**
 * Create Example Tool
 *
 * Demonstrates creating an item with manual response handling.
 *
 * This tool uses manual handling instead of executeVoidApiCall because:
 * - It needs to extract the Location header to get the created item's ID
 * - It returns custom data (success, id, location) instead of just success
 *
 * Use manual handling when you need:
 * - UUID generation or extraction from headers
 * - Custom response transformation
 * - Non-standard status code handling (e.g., 202 Accepted)
 * - Complex request building
 */

import {
  withStandardDecorators,
  createToolResult,
  UmbracoApiError,
  CAPTURE_RAW_HTTP_RESPONSE,
  getApiClient,
  ToolDefinition,
  ToolValidationError,
} from "@umbraco-cms/mcp-toolkit";
import type { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { z } from "zod";

// Type for the API client returned by getExampleUmbracoAddOnAPI()
type ExampleApiClient = ReturnType<typeof getExampleUmbracoAddOnAPI>;

// Define input schema with proper optionality for MCP
// (Zod's .default() doesn't make fields optional in MCP's shape extraction)
const inputSchema = {
  name: z.string().min(1).max(255).describe("Item name"),
  description: z.string().max(2000).nullish().describe("Optional description"),
  isActive: z.boolean().optional().default(true).describe("Whether the item is active"),
};

// Output schema for created item
const outputSchema = z.object({
  success: z.boolean(),
  id: z.string().optional(),
  location: z.string().optional(),
});

const createExampleTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "create-example",
  description: "Creates a new example item.",
  inputSchema,
  outputSchema,
  slices: ["create"],
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
  },
  handler: async ({ name, description, isActive }) => {
    // Example validation using ToolValidationError
    // This is caught by withStandardDecorators and returned as a proper error
    if (name.startsWith("_reserved_")) {
      throw new ToolValidationError({
        title: "Invalid Name",
        detail: "Names starting with '_reserved_' are not allowed",
        extensions: {
          invalidName: name,
        },
      });
    }

    // Manual API call handling for custom response processing
    const client = getApiClient<ExampleApiClient>();
    const response = await client.createItem(
      { name, description, isActive },
      CAPTURE_RAW_HTTP_RESPONSE
    );

    // Check for success (201 Created)
    if (response.status !== 201) {
      // Throw UmbracoApiError - caught by withStandardDecorators
      // Cast response.data since it may contain ProblemDetails on error
      const errorData = response.data as Record<string, unknown> | undefined;
      throw new UmbracoApiError(errorData || {
        status: response.status,
        detail: response.statusText,
      });
    }

    // Extract the location header to get the created item's ID
    const location = response.headers?.Location || response.headers?.location;
    const id = location?.split("/").pop();

    return createToolResult({
      success: true,
      id,
      location,
    });
  },
};

export default withStandardDecorators(createExampleTool);
