/**
 * Update Example Tool
 *
 * Demonstrates updating an existing item using the executeVoidApiCall helper.
 */

import {
  withStandardDecorators,
  executeVoidApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";
import type { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { updateItemParams, updateItemBody } from "../../../api/generated/exampleApi.zod.js";
import { z } from "zod";

// Type for the API client returned by getExampleUmbracoAddOnAPI()
type ExampleApiClient = ReturnType<typeof getExampleUmbracoAddOnAPI>;

// Combine path params and body into single input schema
const inputSchema = {
  ...updateItemParams.shape,
  ...updateItemBody.shape,
};

// Output schema for update result
const outputSchema = z.object({
  success: z.boolean(),
});

const updateExampleTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "update-example",
  description: "Updates an existing example item.",
  inputSchema,
  outputSchema,
  slices: ["update"],
  annotations: {
    destructiveHint: false,
    idempotentHint: true,
  },
  handler: async ({ id, name, description, isActive }) => {
    // executeVoidApiCall handles:
    // - Getting the configured API client
    // - Status code checking (2xx = success, else error)
    // - Throwing UmbracoApiError on failure (caught by withStandardDecorators)
    // - Returning empty tool result on success
    return executeVoidApiCall<ExampleApiClient>(
      (client) => client.updateItem(id, { name, description, isActive }, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(updateExampleTool);
