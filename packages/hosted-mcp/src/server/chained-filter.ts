/**
 * Tool filter for a chained MCP server.
 *
 * The admin config (Worker env plus the resolved site's overrides) is the
 * boundary; the user's consent choices can only narrow it. Collections and
 * slices are resolved here to explicit lists, because the config loader
 * - unions `modes` with `toolCollections`, and
 * - reads an empty list, or a list of names it doesn't know, as "no
 *   restriction".
 * So this never passes `modes`, and whenever a restriction applies but
 * leaves nothing allowed, it blocks every collection with a sentinel.
 */

import {
  expandModesToCollections,
  type ServerConfigForCollections,
  type ToolModeDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { ConsentChoices } from "../types/auth.js";

/** A collection name no server has: the config loader then enables no collection. */
export const NO_TOOLS_SENTINEL = "__none__";

/** The filter passed to `createMcpClientManager` for one chained server. */
export interface ChainedFilterConfig {
  slices?: string[];
  excludeSlices?: string[];
  toolCollections?: string[];
  readOnly?: boolean;
}

export interface ChainedServerRegistry {
  name: string;
  modeRegistry: ToolModeDefinition[];
  allSliceNames?: readonly string[];
}

function intersect(a: string[], b: string[]): string[] {
  return a.filter((value) => b.includes(value));
}

/**
 * The collections the admin's modes allow on this server, or `undefined`
 * when the admin set no modes. Admin modes this server doesn't have allow
 * nothing here, as they do without consent.
 */
function adminCollections(admin: ServerConfigForCollections, server: ChainedServerRegistry): string[] | undefined {
  if (!admin.toolModes?.length) return undefined;
  return expandModesToCollections(admin.toolModes, server.modeRegistry);
}

/**
 * The collections the user selected on this server, or `undefined` when
 * there are no consent choices at all. Consent choices without a selection
 * for this server mean the user selected none of it.
 */
function userCollections(consent: ConsentChoices | undefined, server: ChainedServerRegistry): string[] | undefined {
  if (!consent) return undefined;
  const selectedModes = consent.chainedModeSelections?.[server.name];
  if (!selectedModes) return [];
  const fromModes = expandModesToCollections(selectedModes, server.modeRegistry);
  const selectedCollections = consent.chainedCollectionSelections?.[server.name];
  return selectedCollections ? intersect(fromModes, selectedCollections) : fromModes;
}

/**
 * Resolves the filter for a chained server from the admin config and the
 * user's consent choices. Returns `undefined` when nothing restricts it.
 */
export function resolveChainedFilter(
  admin: ServerConfigForCollections,
  consent: ConsentChoices | undefined,
  server: ChainedServerRegistry
): ChainedFilterConfig | undefined {
  const filter: ChainedFilterConfig = {};
  let blocked = false;

  // Collections: admin's and user's, intersected when both apply.
  const fromAdmin = adminCollections(admin, server);
  const fromUser = userCollections(consent, server);
  const collections = fromAdmin && fromUser ? intersect(fromAdmin, fromUser) : (fromAdmin ?? fromUser);
  if (collections) {
    if (collections.length > 0) filter.toolCollections = collections;
    else blocked = true;
  }

  // Slices. Admin slices this server doesn't know can't match its tools, and
  // the loader would drop them, so only the ones it knows form the boundary.
  const known = server.allSliceNames;
  const adminSlices = (admin.includeSlices ?? []).filter((slice) => !known || known.includes(slice));
  const userSlices = consent?.selectedSlices ?? [];
  if (adminSlices.length > 0) {
    const allowed = userSlices.length > 0 ? intersect(adminSlices, userSlices) : adminSlices;
    if (allowed.length > 0) filter.slices = allowed;
    else blocked = true;
  } else if (userSlices.length > 0) {
    filter.slices = userSlices;
  }

  if (admin.excludeSlices?.length) filter.excludeSlices = admin.excludeSlices;
  if (admin.readonly || consent?.readOnly) filter.readOnly = true;
  if (blocked) filter.toolCollections = [NO_TOOLS_SENTINEL];

  return Object.keys(filter).length > 0 ? filter : undefined;
}
