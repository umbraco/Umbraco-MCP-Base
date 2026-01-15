/**
 * Tool Filter
 *
 * Functions for filtering tools based on collection configuration.
 */

import type { CollectionConfiguration } from "../types/collection-configuration.js";
import type { ToolDefinition } from "../types/tool-definition.js";

/**
 * Options for filtering a tool.
 */
export interface ToolFilterContext {
  /** The collection name this tool belongs to */
  collectionName: string;
  /** The collection configuration to filter against */
  config: CollectionConfiguration;
}

/**
 * Checks if a tool should be included based on collection configuration.
 *
 * Filtering is applied in this order:
 * 1. Tool exclusions (disabledTools) - always excludes
 * 2. Tool inclusions (enabledTools) - if specified, only these tools
 * 3. Slice exclusions (disabledSlices) - excludes tools with these slices
 * 4. Slice inclusions (enabledSlices) - if specified, only tools with these slices
 * 5. Collection exclusions (disabledCollections) - excludes entire collections
 * 6. Collection inclusions (enabledCollections) - if specified, only these collections
 *
 * @param tool - The tool definition to check
 * @param context - Filter context with collection name and config
 * @returns true if the tool should be included
 *
 * @example
 * ```typescript
 * const config = loader.loadFromConfig(serverConfig);
 *
 * for (const tool of collection.tools(user)) {
 *   if (shouldIncludeTool(tool, { collectionName: collection.metadata.name, config })) {
 *     server.registerTool(tool.name, ...);
 *   }
 * }
 * ```
 */
export function shouldIncludeTool(
  tool: Pick<ToolDefinition, "name" | "slices">,
  context: ToolFilterContext
): boolean {
  const { collectionName, config } = context;

  // 1. Tool exclusions - always apply
  if (config.disabledTools.length > 0 && config.disabledTools.includes(tool.name)) {
    return false;
  }

  // 2. Tool inclusions - if specified, only allow these
  if (config.enabledTools.length > 0) {
    return config.enabledTools.includes(tool.name);
  }

  // 3. Slice exclusions - check if tool has any excluded slice
  if (config.disabledSlices.length > 0) {
    const toolSlices = tool.slices || [];
    if (toolSlices.some(slice => config.disabledSlices.includes(slice))) {
      return false;
    }
  }

  // 4. Slice inclusions - if specified, tool must have at least one enabled slice
  if (config.enabledSlices.length > 0) {
    const toolSlices = tool.slices || [];
    // Tools with no slices are considered "other" and should be excluded when specific slices are required
    if (toolSlices.length === 0) {
      return config.enabledSlices.includes("other");
    }
    if (!toolSlices.some(slice => config.enabledSlices.includes(slice))) {
      return false;
    }
  }

  // 5. Collection exclusions - check if collection is excluded
  if (config.disabledCollections.length > 0 && config.disabledCollections.includes(collectionName)) {
    return false;
  }

  // 6. Collection inclusions - if specified, collection must be in list
  if (config.enabledCollections.length > 0) {
    return config.enabledCollections.includes(collectionName);
  }

  // No filters apply - include the tool
  return true;
}

/**
 * Filters an array of tools based on collection configuration.
 *
 * @param tools - Array of tool definitions
 * @param collectionName - The collection name these tools belong to
 * @param config - The collection configuration
 * @returns Filtered array of tools
 */
export function filterTools<T extends Pick<ToolDefinition, "name" | "slices">>(
  tools: T[],
  collectionName: string,
  config: CollectionConfiguration
): T[] {
  return tools.filter(tool => shouldIncludeTool(tool, { collectionName, config }));
}
