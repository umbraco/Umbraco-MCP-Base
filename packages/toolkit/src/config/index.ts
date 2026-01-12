/**
 * MCP Toolkit Configuration
 *
 * Configuration utilities for loading and processing collection configuration.
 */

export {
  createCollectionConfigLoader,
  type ServerConfigForCollections,
  type CollectionConfigLoaderOptions,
} from "./collection-config-loader.js";

export {
  validateSliceNames,
} from "./slice-matcher.js";

export {
  validateModeNames,
  expandModesToCollections,
  getModeExpansionSummary,
  type ModeValidationResult,
} from "./mode-expander.js";
