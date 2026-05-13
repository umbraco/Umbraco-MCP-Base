import { describe, it, expect } from "@jest/globals";
import { shouldIncludeTool, filterTools } from "../tool-filter.js";
import type { ToolDefinition } from "../../types/tool-definition.js";
import type { CollectionConfiguration } from "../../types/collection-configuration.js";

const PASS_THROUGH_CONFIG: CollectionConfiguration = {
  enabledCollections: [],
  disabledCollections: [],
  enabledTools: [],
  disabledTools: [],
  enabledSlices: [],
  disabledSlices: [],
  readOnly: false,
};

function tool(name: string, chainedDeps?: readonly string[]): ToolDefinition {
  return {
    name,
    description: name,
    slices: [],
    handler: (async () => ({ content: [] })) as any,
    ...(chainedDeps ? { chainedDeps } : {}),
  };
}

describe("shouldIncludeTool — chainedDeps", () => {
  const collectionName = "test";

  it("includes a tool with no chainedDeps regardless of availability set", () => {
    const t = tool("no-deps");
    expect(
      shouldIncludeTool(t, {
        collectionName,
        config: PASS_THROUGH_CONFIG,
        availableChainedTools: new Set(),
      }),
    ).toBe(true);
  });

  it("includes a tool when every dep is in the available set", () => {
    const t = tool("with-deps", ["dev-a", "dev-b"]);
    expect(
      shouldIncludeTool(t, {
        collectionName,
        config: PASS_THROUGH_CONFIG,
        availableChainedTools: new Set(["dev-a", "dev-b", "dev-c"]),
      }),
    ).toBe(true);
  });

  it("excludes a tool when any dep is missing", () => {
    const t = tool("with-deps", ["dev-a", "dev-missing"]);
    expect(
      shouldIncludeTool(t, {
        collectionName,
        config: PASS_THROUGH_CONFIG,
        availableChainedTools: new Set(["dev-a"]),
      }),
    ).toBe(false);
  });

  it("ignores chainedDeps entirely when no availability set is provided", () => {
    const t = tool("with-deps", ["definitely-not-available"]);
    expect(
      shouldIncludeTool(t, {
        collectionName,
        config: PASS_THROUGH_CONFIG,
      }),
    ).toBe(true);
  });

  it("dep check runs after other rules — excluded tools stay excluded", () => {
    const t = tool("disabled-and-has-deps", ["dev-a"]);
    expect(
      shouldIncludeTool(t, {
        collectionName,
        config: { ...PASS_THROUGH_CONFIG, disabledTools: ["disabled-and-has-deps"] },
        availableChainedTools: new Set(["dev-a"]),
      }),
    ).toBe(false);
  });

  it("filterTools applies chainedDeps gating to a tool array", () => {
    const tools = [tool("a"), tool("b", ["dev-b"]), tool("c", ["dev-c", "dev-x"])];
    const out = filterTools(tools, collectionName, PASS_THROUGH_CONFIG, new Set(["dev-b"]));
    expect(out.map((t) => t.name)).toEqual(["a", "b"]);
  });
});
