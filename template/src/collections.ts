/**
 * Tool Collections Export
 *
 * Lightweight entry point for in-process chaining.
 * Import this from another MCP server to chain tools without spawning a process.
 *
 * @example
 * ```typescript
 * import { collections, allModes, allModeNames, allSliceNames } from "my-umbraco-mcp/collections";
 *
 * manager.registerServer({
 *   transport: "in-process",
 *   name: "my-addon",
 *   collections,
 *   modeRegistry: allModes,
 *   allModeNames,
 *   allSliceNames,
 * });
 * ```
 */

import exampleCollection from "./umbraco-api/tools/example/index.js";
import example2Collection from "./umbraco-api/tools/example-2/index.js";
import umbracoServerCollection from "./umbraco-api/tools/umbraco-server/index.js";

export const collections = [
  exampleCollection,
  example2Collection,
  umbracoServerCollection,
];

export { allModes, allModeNames } from "./config/mode-registry.js";
export { allSliceNames } from "./config/slice-registry.js";
