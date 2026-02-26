/**
 * Worker Config Loader
 *
 * Reads tool filtering configuration from Cloudflare Worker env bindings
 * and converts them to the SDK's ServerConfigForCollections format.
 */

import type { ServerConfigForCollections } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";

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

  // Readonly mode shorthand: exclude all write slices
  if (env.UMBRACO_READONLY === "true") {
    const writeSlices = ["create", "update", "delete"];
    config.excludeSlices = [
      ...(config.excludeSlices ?? []),
      ...writeSlices.filter((s) => !(config.excludeSlices ?? []).includes(s)),
    ];
  }

  return config;
}
