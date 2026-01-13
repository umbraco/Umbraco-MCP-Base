/**
 * Search Examples Tool
 *
 * Demonstrates searching items by name using the executeGetApiCall helper.
 */

import {
  withStandardDecorators,
  executeGetApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";
import type { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { searchItemsQueryParams, searchItemsResponse } from "../../../api/generated/exampleApi.zod.js";

// Type for the API client returned by getExampleUmbracoAddOnAPI()
type ExampleApiClient = ReturnType<typeof getExampleUmbracoAddOnAPI>;

// Use the generated Zod schemas
const inputSchema = searchItemsQueryParams.shape;
const outputSchema = searchItemsResponse;

const searchExamplesTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "search-examples",
  description: "Searches example items by name.",
  inputSchema,
  outputSchema,
  slices: ["search"],
  annotations: {
    readOnlyHint: true,
  },
  handler: async ({ query, skip, take }) => {
    // executeGetApiCall handles:
    // - Getting the configured API client
    // - Status code checking (2xx = success, else error)
    // - Throwing UmbracoApiError on failure (caught by withStandardDecorators)
    // - Returning createToolResult with the response data
    return executeGetApiCall<ReturnType<ExampleApiClient["searchItems"]>, ExampleApiClient>(
      (client) => client.searchItems({ query, skip, take }, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(searchExamplesTool);
