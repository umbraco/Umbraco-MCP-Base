/**
 * List Examples Tool
 *
 * Demonstrates listing items with pagination using the executeGetApiCall helper.
 */

import {
  withStandardDecorators,
  executeGetApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";
import type { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { getItemsQueryParams, getItemsResponse } from "../../../api/generated/exampleApi.zod.js";

// Type for the API client returned by getExampleUmbracoAddOnAPI()
type ExampleApiClient = ReturnType<typeof getExampleUmbracoAddOnAPI>;

// Use the generated Zod schemas
const inputSchema = getItemsQueryParams.shape;
const outputSchema = getItemsResponse;

const listExamplesTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "list-examples",
  description: "Lists all example items with pagination.",
  inputSchema,
  outputSchema,
  slices: ["read"],
  annotations: {
    readOnlyHint: true,
  },
  handler: async ({ skip, take }) => {
    // executeGetApiCall handles:
    // - Getting the configured API client
    // - Status code checking (2xx = success, else error)
    // - Throwing UmbracoApiError on failure (caught by withStandardDecorators)
    // - Returning createToolResult with the response data
    return executeGetApiCall<ReturnType<ExampleApiClient["getItems"]>, ExampleApiClient>(
      (client) => client.getItems({ skip, take }, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(listExamplesTool);
