/**
 * MCP Toolkit Types
 *
 * Core type definitions for building MCP tools.
 */

export type {
  ToolDefinition,
  ToolAnnotations,
  UserModel,
  BaseSliceName,
} from "./tool-definition.js";

export {
  baseSliceNames,
  allBaseSliceNames,
} from "./tool-definition.js";

export type {
  ToolCollectionMetadata,
  ToolCollectionExport,
} from "./tool-collection.js";

export type {
  CollectionConfiguration,
} from "./collection-configuration.js";

export {
  DEFAULT_COLLECTION_CONFIG,
} from "./collection-configuration.js";

export type {
  ToolModeDefinition,
} from "./tool-mode.js";
