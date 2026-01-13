/**
 * Delete Example Tool
 *
 * Demonstrates deleting an item using the executeVoidApiCall helper.
 */

import {
  withStandardDecorators,
  executeVoidApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";
import type { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { deleteItemParams } from "../../../api/generated/exampleApi.zod.js";

// Type for the API client returned by getExampleUmbracoAddOnAPI()
type ExampleApiClient = ReturnType<typeof getExampleUmbracoAddOnAPI>;

// Use the generated Zod schema for input
const inputSchema = deleteItemParams.shape;

const deleteExampleTool: ToolDefinition<typeof inputSchema> = {
  name: "delete-example",
  description: "Deletes an example item by ID.",
  inputSchema,
  slices: ["delete"],
  annotations: {
    destructiveHint: true,
    idempotentHint: false,
  },
  handler: async ({ id }) => {
    // executeVoidApiCall handles:
    // - Getting the configured API client
    // - Status code checking (2xx = success, else error)
    // - Throwing UmbracoApiError on failure (caught by withStandardDecorators)
    // - Returning empty tool result on success
    return executeVoidApiCall<ExampleApiClient>(
      (client) => client.deleteItem(id, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(deleteExampleTool);
