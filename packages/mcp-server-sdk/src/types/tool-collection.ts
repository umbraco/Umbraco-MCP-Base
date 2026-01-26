/**
 * Tool Collection Types
 *
 * Types for organizing tools into collections.
 */

import { ToolDefinition } from "./tool-definition.js";

/**
 * Metadata describing a tool collection.
 */
export interface ToolCollectionMetadata {
  /** Collection key (e.g., 'culture', 'data-type') */
  name: string;
  /** Human readable name */
  displayName: string;
  /** Collection description */
  description: string;
  /** Required collections this depends on */
  dependencies?: string[];
}

/**
 * Export interface for a tool collection module.
 *
 * @typeParam TUser - User model type for tool enabled checks (defaults to any)
 */
export interface ToolCollectionExport<TUser = any> {
  /** Collection metadata */
  metadata: ToolCollectionMetadata;
  /** Function that returns tools filtered by user permissions */
  tools: (user: TUser) => ToolDefinition<any, any, TUser>[];
}
