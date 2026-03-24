/**
 * Demo Chained MCP
 *
 * A simple mock MCP server used to test in-process chaining
 * on the hosted consent screen and /info endpoint.
 * No Umbraco dependency — all tools return static data.
 */

import notificationCollection from "./collections/notification/index.js";
import analyticsCollection from "./collections/analytics/index.js";
import umbracoCollection from "./collections/umbraco/index.js";

export const collections = [notificationCollection, analyticsCollection, umbracoCollection];

export { allModes, allModeNames } from "./mode-registry.js";
export { allSliceNames } from "./slice-registry.js";
