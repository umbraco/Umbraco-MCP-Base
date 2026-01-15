/**
 * Example-2 Tool Collection
 *
 * A second example collection for testing collection and mode filtering.
 * Uses simple mock tools that don't require API clients.
 */

import { ToolCollectionExport } from "@umbraco-cms/mcp-toolkit";
import getWidgetTool from "./get/get-widget.js";
import listWidgetsTool from "./get/list-widgets.js";
import createWidgetTool from "./post/create-widget.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "example-2",
    displayName: "Example-2 Tools",
    description: "Second example collection for testing collection/mode filtering",
  },
  tools: () => [
    // Read operations
    getWidgetTool,
    listWidgetsTool,
    // Create operation
    createWidgetTool,
  ],
};

export default collection;
