/**
 * Collection Configuration Types
 *
 * Types for configuring which collections, slices, and tools are loaded.
 */

/**
 * Configuration for filtering collections, slices, and tools.
 */
export interface CollectionConfiguration {
  /** Collection names to include (if specified, only these load) */
  enabledCollections: string[];
  /** Collection names to exclude (always excluded) */
  disabledCollections: string[];
  /** Slice names to include (if specified, only tools in these slices load) */
  enabledSlices: string[];
  /** Slice names to exclude (tools in these slices never load) */
  disabledSlices: string[];
  /** Individual tool names to include (if specified, only these load) */
  enabledTools: string[];
  /** Individual tool names to exclude (always excluded) */
  disabledTools: string[];
}

/**
 * Default collection configuration with all filters empty (include everything).
 */
export const DEFAULT_COLLECTION_CONFIG: CollectionConfiguration = {
  enabledCollections: [],
  disabledCollections: [],
  enabledSlices: [],
  disabledSlices: [],
  enabledTools: [],
  disabledTools: [],
};
