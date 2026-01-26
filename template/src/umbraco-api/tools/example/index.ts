/**
 * Example Tool Collection
 *
 * Demonstrates the full CRUD pattern using generated API clients.
 * Replace this with your actual tools for your Umbraco add-on.
 */

import { ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import getExampleTool from "./get/get-example.js";
import listExamplesTool from "./get/list-examples.js";
import searchExamplesTool from "./get/search-examples.js";
import createExampleTool from "./post/create-example.js";
import updateExampleTool from "./put/update-example.js";
import deleteExampleTool from "./delete/delete-example.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "example",
    displayName: "Example Tools",
    description: "Example tool collection demonstrating CRUD patterns with generated API clients",
  },
  tools: () => [
    // Read operations
    getExampleTool,
    listExamplesTool,
    searchExamplesTool,
    // Create operation
    createExampleTool,
    // Update operation
    updateExampleTool,
    // Delete operation
    deleteExampleTool,
  ],
};

export default collection;
