/**
 * Get Example Tool
 *
 * Demonstrates fetching a single item by ID using the executeGetApiCall helper.
 */

import {
  withStandardDecorators,
  executeGetApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";
import type { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { getItemByIdParams, getItemByIdResponse } from "../../../api/generated/exampleApi.zod.js";

// Type for the API client returned by getExampleUmbracoAddOnAPI()
type ExampleApiClient = ReturnType<typeof getExampleUmbracoAddOnAPI>;

// Use the generated Zod schemas
const inputSchema = getItemByIdParams.shape;
const outputSchema = getItemByIdResponse;

const getExampleTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "get-example",
  description: "Gets an example item by ID.",
  inputSchema,
  outputSchema,
  slices: ["read"],
  annotations: {
    readOnlyHint: true,
  },
  handler: async ({ id }) => {
    // executeGetApiCall handles:
    // - Getting the configured API client
    // - Status code checking (2xx = success, else error)
    // - Throwing UmbracoApiError on failure (caught by withStandardDecorators)
    // - Returning createToolResult with the response data
    return executeGetApiCall<ReturnType<ExampleApiClient["getItemById"]>, ExampleApiClient>(
      (client) => client.getItemById(id, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(getExampleTool);
