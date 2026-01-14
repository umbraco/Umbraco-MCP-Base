/**
 * Collection Config Loader
 *
 * Loads and processes collection configuration from server config.
 */

import { CollectionConfiguration, DEFAULT_COLLECTION_CONFIG } from "../types/collection-configuration.js";
import { ToolModeDefinition } from "../types/tool-mode.js";
import { expandModesToCollections, validateModeNames } from "./mode-expander.js";
import { validateSliceNames } from "./slice-matcher.js";

/**
 * Server configuration interface for collection loading.
 * Implement this interface in your server config type.
 */
export interface ServerConfigForCollections {
  /** Tool collections to include */
  includeToolCollections?: string[];
  /** Tool collections to exclude */
  excludeToolCollections?: string[];
  /** Tool modes to enable (expand to collections) */
  toolModes?: string[];
  /** Tool slices to include */
  includeSlices?: string[];
  /** Tool slices to exclude */
  excludeSlices?: string[];
  /** Individual tools to include */
  includeTools?: string[];
  /** Individual tools to exclude */
  excludeTools?: string[];
}

/**
 * Options for loading collection configuration.
 */
export interface CollectionConfigLoaderOptions {
  /** All available mode definitions */
  modeRegistry: ToolModeDefinition[];
  /** All valid mode names */
  allModeNames: readonly string[];
  /** All valid slice names (optional, uses default if not provided) */
  allSliceNames?: readonly string[];
}

/**
 * Creates a collection config loader with the provided registries.
 *
 * @param options - Loader options with mode registry
 * @returns Object with loadFromConfig method
 *
 * @example
 * ```typescript
 * const loader = createCollectionConfigLoader({
 *   modeRegistry: myModes,
 *   allModeNames: myModes.map(m => m.name)
 * });
 *
 * const config = loader.loadFromConfig(serverConfig);
 * ```
 */
export function createCollectionConfigLoader(options: CollectionConfigLoaderOptions) {
  const { modeRegistry, allModeNames, allSliceNames: customSliceNames } = options;

  return {
    loadFromConfig: (config: ServerConfigForCollections): CollectionConfiguration => {
      // Start with direct collection includes
      let enabledCollections = config.includeToolCollections ?? [];

      // Expand modes to collections and merge
      if (config.toolModes && config.toolModes.length > 0) {
        // Validate mode names and warn about invalid ones
        const { validModes, invalidModes } = validateModeNames(config.toolModes, allModeNames);

        if (invalidModes.length > 0) {
          console.warn(`Unknown tool modes (ignored): ${invalidModes.join(', ')}`);
        }

        if (validModes.length > 0) {
          // Expand valid modes to collections
          const collectionsFromModes = expandModesToCollections(validModes, modeRegistry);

          // Merge with direct includes (deduplicate)
          const allEnabled = new Set([...enabledCollections, ...collectionsFromModes]);
          enabledCollections = Array.from(allEnabled);
        }
      }

      // Handle slice configuration
      let enabledSlices: string[] = [];
      let disabledSlices: string[] = [];

      if (config.includeSlices && config.includeSlices.length > 0) {
        const { valid, invalid } = validateSliceNames(config.includeSlices, customSliceNames);
        if (invalid.length > 0) {
          console.warn(`Unknown tool slices (ignored): ${invalid.join(', ')}`);
        }
        enabledSlices = valid;
      }

      if (config.excludeSlices && config.excludeSlices.length > 0) {
        const { valid, invalid } = validateSliceNames(config.excludeSlices, customSliceNames);
        if (invalid.length > 0) {
          console.warn(`Unknown tool slices (ignored): ${invalid.join(', ')}`);
        }
        disabledSlices = valid;
      }

      return {
        enabledCollections: enabledCollections.length > 0 ? enabledCollections : DEFAULT_COLLECTION_CONFIG.enabledCollections,
        disabledCollections: config.excludeToolCollections ?? DEFAULT_COLLECTION_CONFIG.disabledCollections,
        enabledSlices,
        disabledSlices,
        enabledTools: config.includeTools ?? DEFAULT_COLLECTION_CONFIG.enabledTools,
        disabledTools: config.excludeTools ?? DEFAULT_COLLECTION_CONFIG.disabledTools,
      };
    }
  };
}
