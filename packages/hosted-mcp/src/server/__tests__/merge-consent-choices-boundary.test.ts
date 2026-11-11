/**
 * Consent choices can only narrow the admin config.
 *
 * The config loader reads an empty mode or slice list as "no restriction", so
 * a consent selection that shares nothing with the admin's list must end up
 * with no tools, never with the admin's restriction lifted. These tests run
 * the merged config through the real loader and tool filter.
 */

import { describe, it, expect } from "@jest/globals";
import {
  createCollectionConfigLoader,
  shouldIncludeTool,
  type ServerConfigForCollections,
} from "@umbraco-cms/mcp-server-sdk";
import { mergeConsentChoices } from "../create-server.js";
import type { ConsentChoices } from "../../types/auth.js";

const modeRegistry = [
  { name: "content", displayName: "Content", description: "", collections: ["document"] },
  { name: "media", displayName: "Media", description: "", collections: ["media"] },
  { name: "users", displayName: "Users", description: "", collections: ["user"] },
];
const loader = createCollectionConfigLoader({
  modeRegistry,
  allModeNames: ["content", "media", "users"],
  allSliceNames: ["read", "list", "delete"],
});

const tools = [
  { collection: "document", name: "get-document", slices: ["read"] },
  { collection: "document", name: "delete-document", slices: ["delete"] },
  { collection: "media", name: "list-media", slices: ["list"] },
  { collection: "user", name: "get-user", slices: ["read"] },
  { collection: "user", name: "delete-user", slices: ["delete"] },
];

/** Names of the tools left after merging `choices` into `admin`. */
function allowedTools(admin: ServerConfigForCollections, choices?: ConsentChoices): string[] {
  const filter = loader.loadFromConfig(mergeConsentChoices(admin, choices, modeRegistry));
  return tools
    .filter((t) => shouldIncludeTool({ name: t.name, slices: t.slices }, { collectionName: t.collection, config: filter }))
    .map((t) => t.name);
}

const admin: ServerConfigForCollections = {
  toolModes: ["content", "media"],
  includeSlices: ["read", "list"],
};
const adminAllows = ["get-document", "list-media"];

describe("consent choices never widen the admin config", () => {
  it("the admin config alone allows the expected tools", () => {
    expect(allowedTools(admin)).toEqual(adminAllows);
  });

  it("selecting only a mode the admin doesn't allow leaves no tools", () => {
    expect(allowedTools(admin, { selectedModes: ["users"] })).toEqual([]);
  });

  it("selecting only a slice the admin doesn't allow leaves no tools", () => {
    expect(allowedTools(admin, { selectedSlices: ["delete"] })).toEqual([]);
  });

  it("selecting neither an allowed mode nor an allowed slice leaves no tools", () => {
    expect(allowedTools(admin, { selectedModes: ["users"], selectedSlices: ["delete"] })).toEqual([]);
  });

  it("a made-up mode or slice name leaves no tools", () => {
    expect(allowedTools(admin, { selectedModes: ["no-such-mode"] })).toEqual([]);
    expect(allowedTools(admin, { selectedSlices: ["no-such-slice"] })).toEqual([]);
  });

  it("a selection that mixes allowed and disallowed values keeps only the allowed ones", () => {
    expect(allowedTools(admin, { selectedModes: ["content", "users"], selectedSlices: ["read", "delete"] })).toEqual([
      "get-document",
    ]);
  });

  it.each<ConsentChoices>([
    { selectedModes: ["users"] },
    { selectedSlices: ["delete"] },
    { selectedModes: ["content", "users"], selectedSlices: ["read", "delete"] },
    { selectedModes: ["media"], selectedCollections: ["media"] },
    { readOnly: true },
  ])("%j never allows a tool the admin config doesn't", (choices) => {
    for (const tool of allowedTools(admin, choices)) {
      expect(adminAllows).toContain(tool);
    }
  });

  it("still narrows normally when the admin set no restriction", () => {
    expect(allowedTools({}, { selectedModes: ["users"], selectedSlices: ["delete"] })).toEqual(["delete-user"]);
  });
});
