/**
 * Worker Config Loader
 *
 * Reads tool filtering configuration from Cloudflare Worker env bindings
 * and converts them to the SDK's ServerConfigForCollections format.
 */

import type { ServerConfigForCollections } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import type { SiteConfig } from "../types/multi-site.js";

/**
 * Parses a comma-separated env var into a string array.
 * Returns empty array for undefined/empty values.
 */
function parseCsv(value: string | undefined): string[] {
  if (!value || value.trim() === "") return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Loads tool filtering config from Cloudflare Worker environment bindings.
 *
 * Maps Worker env vars to the SDK's ServerConfigForCollections interface,
 * which can then be passed to createCollectionConfigLoader().loadFromConfig().
 *
 * @param env - Cloudflare Worker environment bindings
 * @returns Configuration compatible with the SDK's collection config loader
 *
 * @example
 * ```typescript
 * const serverConfig = loadWorkerConfig(env);
 * const configLoader = createCollectionConfigLoader({
 *   modeRegistry: allModes,
 *   allModeNames,
 *   allSliceNames,
 * });
 * const filterConfig = configLoader.loadFromConfig(serverConfig);
 * ```
 */
export function loadWorkerConfig(env: HostedMcpEnv): ServerConfigForCollections {
  const config: ServerConfigForCollections = {};

  // Tool modes (e.g., UMBRACO_TOOL_MODES="content,media")
  const modes = parseCsv(env.UMBRACO_TOOL_MODES);
  if (modes.length > 0) {
    config.toolModes = modes;
  }

  // Include slices (e.g., UMBRACO_INCLUDE_SLICES="read,list")
  const includeSlices = parseCsv(env.UMBRACO_INCLUDE_SLICES);
  if (includeSlices.length > 0) {
    config.includeSlices = includeSlices;
  }

  // Exclude slices (e.g., UMBRACO_EXCLUDE_SLICES="delete,create")
  const excludeSlices = parseCsv(env.UMBRACO_EXCLUDE_SLICES);
  if (excludeSlices.length > 0) {
    config.excludeSlices = excludeSlices;
  }

  // Readonly mode: annotation-based filtering via readonly flag
  if (env.UMBRACO_READONLY === "true") {
    config.readonly = true;
  }

  return config;
}

/**
 * Merges site-specific filter overrides into a base config.
 *
 * Site-level overrides (from SiteConfig) are applied on top of the base
 * config from env vars. Site values replace base values where specified.
 *
 * @param site - Site-specific configuration
 * @param baseConfig - Base config from loadWorkerConfig(env)
 * @returns Merged configuration
 */
export function loadSiteConfig(
  site: SiteConfig,
  baseConfig: ServerConfigForCollections
): ServerConfigForCollections {
  const config = { ...baseConfig };

  const siteModes = parseCsv(site.toolModes);
  if (siteModes.length > 0) {
    config.toolModes = siteModes;
  }

  const siteIncludeSlices = parseCsv(site.includeSlices);
  if (siteIncludeSlices.length > 0) {
    config.includeSlices = siteIncludeSlices;
  }

  const siteExcludeSlices = parseCsv(site.excludeSlices);
  if (siteExcludeSlices.length > 0) {
    config.excludeSlices = siteExcludeSlices;
  }

  if (site.readOnly === "true") {
    config.readonly = true;
  }

  return config;
}
