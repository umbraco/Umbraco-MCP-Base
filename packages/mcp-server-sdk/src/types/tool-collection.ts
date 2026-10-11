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
 * Per-call options passed to `ToolCollectionExport.tools()`.
 */
export interface ToolCollectionToolsOptions {
  /**
   * Raw version string of the connected Umbraco (e.g. `"17.6.0-rc.1"`), when
   * the host knows it. Collections that list a tool only on newer sites gate
   * on it with `isAtLeast(options?.umbracoVersion, major, minor)`. Absent means
   * "oldest": list the legacy variants.
   */
  umbracoVersion?: string;
}

/**
 * Export interface for a tool collection module.
 *
 * @typeParam TUser - User model type for tool enabled checks (defaults to any)
 */
export interface ToolCollectionExport<TUser = any> {
  /** Collection metadata */
  metadata: ToolCollectionMetadata;
  /**
   * Function that returns tools filtered by user permissions and, optionally,
   * by the connected Umbraco version. A collection that declares only
   * `tools(user)` is still valid — the extra argument is optional.
   */
  tools: (user: TUser, options?: ToolCollectionToolsOptions) => ToolDefinition<any, any, TUser>[];
}
