/**
 * `resolveChainedFilter` — a chained server's tools stay within the admin
 * config, whatever the consent form submits.
 *
 * Each case runs the resolved filter through the same config loader and tool
 * filter the in-process chained connection uses.
 */

import { describe, it, expect } from "@jest/globals";
import {
  createCollectionConfigLoader,
  shouldIncludeTool,
  type ServerConfigForCollections,
} from "@umbraco-cms/mcp-server-sdk";
import { resolveChainedFilter } from "../chained-filter.js";
import type { ConsentChoices } from "../../types/auth.js";

const server = {
  name: "demo",
  modeRegistry: [
    { name: "content", displayName: "Content", description: "", collections: ["document"] },
    { name: "media", displayName: "Media", description: "", collections: ["media"] },
  ],
  allModeNames: ["content", "media"] as readonly string[],
  allSliceNames: ["read", "list", "delete"] as readonly string[],
};

const tools = [
  { collection: "document", name: "get-document", slices: ["read"] },
  { collection: "document", name: "delete-document", slices: ["delete"] },
  { collection: "media", name: "get-media", slices: ["read"] },
  { collection: "media", name: "list-media", slices: ["list"] },
];

/** Names of the chained tools left for `admin` + `consent`, as the in-process connection filters them. */
function allowedTools(admin: ServerConfigForCollections, consent?: ConsentChoices): string[] {
  const filter = resolveChainedFilter(admin, consent, server);
  const loader = createCollectionConfigLoader({
    modeRegistry: server.modeRegistry,
    allModeNames: server.allModeNames,
    allSliceNames: server.allSliceNames,
  });
  const config = loader.loadFromConfig({
    includeToolCollections: filter?.toolCollections,
    includeSlices: filter?.slices,
    excludeSlices: filter?.excludeSlices,
    toolModes: (filter as { modes?: string[] } | undefined)?.modes,
    readonly: filter?.readOnly,
  });
  return tools
    .filter((t) => shouldIncludeTool({ name: t.name, slices: t.slices }, { collectionName: t.collection, config }))
    .map((t) => t.name);
}

const everything = tools.map((t) => t.name);
const selectAll: ConsentChoices = { chainedModeSelections: { demo: ["content", "media"] } };

describe("resolveChainedFilter", () => {
  it("restricts nothing when neither the admin nor the user does", () => {
    expect(resolveChainedFilter({}, undefined, server)).toBeUndefined();
    expect(allowedTools({})).toEqual(everything);
  });

  it("never passes modes, which the loader would union with the collections", () => {
    expect(resolveChainedFilter({ toolModes: ["content"] }, selectAll, server)).not.toHaveProperty("modes");
  });

  describe("modes", () => {
    const admin = { toolModes: ["content"] };

    it("applies the admin's modes on their own", () => {
      expect(allowedTools(admin)).toEqual(["get-document", "delete-document"]);
    });

    it("a user selection outside the admin's modes adds nothing", () => {
      expect(allowedTools(admin, { chainedModeSelections: { demo: ["media"] } })).toEqual([]);
    });

    it("a user selection is intersected with the admin's modes", () => {
      expect(allowedTools(admin, selectAll)).toEqual(["get-document", "delete-document"]);
    });

    it("admin modes this server doesn't have allow none of it, with or without a selection", () => {
      const mainOnly = { toolModes: ["some-main-server-mode"] };
      expect(allowedTools(mainOnly)).toEqual([]);
      expect(allowedTools(mainOnly, selectAll)).toEqual([]);
    });

    it("consent choices without a selection for this server mean none of it", () => {
      expect(allowedTools({}, { selectedModes: ["anything"] })).toEqual([]);
    });

    it("a selection of modes this server doesn't have means none of it", () => {
      expect(allowedTools({}, { chainedModeSelections: { demo: ["no-such-mode"] } })).toEqual([]);
    });

    it("narrows to the selected collections within the selected modes", () => {
      expect(
        allowedTools({}, { chainedModeSelections: { demo: ["content", "media"] }, chainedCollectionSelections: { demo: ["media"] } })
      ).toEqual(["get-media", "list-media"]);
    });
  });

  describe("slices", () => {
    const admin = { includeSlices: ["read", "list"] };

    it("the user's slices narrow the admin's", () => {
      expect(allowedTools(admin, { ...selectAll, selectedSlices: ["list", "delete"] })).toEqual(["list-media"]);
    });

    it("slices that share nothing with the admin's leave no tools", () => {
      expect(allowedTools(admin, { ...selectAll, selectedSlices: ["delete"] })).toEqual([]);
    });

    it("still leaves no tools when the admin also allows a mode on this server", () => {
      expect(
        allowedTools({ toolModes: ["content"], includeSlices: ["read"] }, { ...selectAll, selectedSlices: ["delete"] })
      ).toEqual([]);
    });

    it("an admin slice this server doesn't know isn't a way to lift the restriction", () => {
      const withUnknown = { includeSlices: ["read", "publish"] };
      expect(allowedTools(withUnknown, selectAll)).toEqual(["get-document", "get-media"]);
      expect(allowedTools(withUnknown, { ...selectAll, selectedSlices: ["publish"] })).toEqual([]);
    });

    it("applies the user's slices when the admin set none", () => {
      expect(allowedTools({}, { ...selectAll, selectedSlices: ["delete"] })).toEqual(["delete-document"]);
    });

    it("keeps the admin's excluded slices", () => {
      expect(allowedTools({ excludeSlices: ["delete"] }, selectAll)).toEqual(["get-document", "get-media", "list-media"]);
    });
  });

  it("read-only is on when either the admin or the user sets it", () => {
    expect(resolveChainedFilter({ readonly: true }, undefined, server)?.readOnly).toBe(true);
    expect(resolveChainedFilter({}, { ...selectAll, readOnly: true }, server)?.readOnly).toBe(true);
    expect(resolveChainedFilter({}, selectAll, server)?.readOnly).toBeUndefined();
  });

  it.each<ConsentChoices>([
    { chainedModeSelections: { demo: ["media"] } },
    { chainedModeSelections: { demo: ["content", "media"] }, selectedSlices: ["delete"] },
    { chainedModeSelections: { demo: ["media"] }, selectedSlices: ["publish"] },
    { chainedModeSelections: { demo: ["no-such-mode"] }, selectedSlices: ["no-such-slice"] },
    { selectedModes: ["x"] },
  ])("%j never allows a tool the admin config doesn't", (consent) => {
    const admin = { toolModes: ["content"], includeSlices: ["read", "publish"] };
    const adminAllows = allowedTools(admin);
    for (const tool of allowedTools(admin, consent)) expect(adminAllows).toContain(tool);
  });
});
