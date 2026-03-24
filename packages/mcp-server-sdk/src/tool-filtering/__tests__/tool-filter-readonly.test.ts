// Tool Filter Tests
import { shouldIncludeTool, filterTools } from "../tool-filter.js";
import type { CollectionConfiguration } from "../../types/collection-configuration.js";
import { DEFAULT_COLLECTION_CONFIG } from "../../types/collection-configuration.js";

function createConfig(overrides: Partial<CollectionConfiguration> = {}): CollectionConfiguration {
  return { ...DEFAULT_COLLECTION_CONFIG, ...overrides };
}

describe("shouldIncludeTool", () => {
  describe("readOnly mode", () => {
    it("excludes tools without readOnlyHint when readOnly is true", () => {
      const tool = { name: "create-doc", slices: ["create"] };
      const config = createConfig({ readOnly: true });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(false);
    });

    it("includes tools with annotations.readOnlyHint when readOnly is true", () => {
      const tool = {
        name: "get-doc",
        slices: ["read"],
        annotations: { readOnlyHint: true, openWorldHint: true },
      };
      const config = createConfig({ readOnly: true });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(true);
    });

    it("includes tools with deprecated isReadOnly when readOnly is true", () => {
      const tool = { name: "list-docs", slices: ["list"], isReadOnly: true };
      const config = createConfig({ readOnly: true });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(true);
    });

    it("has no effect when readOnly is false", () => {
      const tool = { name: "create-doc", slices: ["create"] };
      const config = createConfig({ readOnly: false });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(true);
    });

    it("readOnly takes precedence over other inclusion rules", () => {
      const tool = { name: "create-doc", slices: ["create"] };
      const config = createConfig({
        readOnly: true,
        enabledTools: ["create-doc"],
      });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(false);
    });

    it("excludes tools with readOnlyHint: false", () => {
      const tool = {
        name: "update-doc",
        slices: ["update"],
        annotations: { readOnlyHint: false, openWorldHint: true },
      };
      const config = createConfig({ readOnly: true });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(false);
    });

    it("excludes tools with no annotations at all", () => {
      const tool = { name: "delete-doc", slices: ["delete"] };
      const config = createConfig({ readOnly: true });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(false);
    });
  });

  describe("existing filtering (non-readOnly)", () => {
    it("excludes tools in disabledTools", () => {
      const tool = { name: "bad-tool", slices: [] };
      const config = createConfig({ disabledTools: ["bad-tool"] });
      expect(shouldIncludeTool(tool, { collectionName: "test", config })).toBe(false);
    });

    it("only includes tools in enabledTools when specified", () => {
      const tool = { name: "other-tool", slices: [] };
      const config = createConfig({ enabledTools: ["good-tool"] });
      expect(shouldIncludeTool(tool, { collectionName: "test", config })).toBe(false);
    });

    it("excludes tools with disabled slices", () => {
      const tool = { name: "create-doc", slices: ["create"] };
      const config = createConfig({ disabledSlices: ["create"] });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(false);
    });

    it("only includes tools with enabled slices when specified", () => {
      const tool = { name: "create-doc", slices: ["create"] };
      const config = createConfig({ enabledSlices: ["read"] });
      expect(shouldIncludeTool(tool, { collectionName: "document", config })).toBe(false);
    });

    it("includes tools when no filters apply", () => {
      const tool = { name: "any-tool", slices: ["read"] };
      const config = createConfig();
      expect(shouldIncludeTool(tool, { collectionName: "test", config })).toBe(true);
    });
  });
});

describe("filterTools", () => {
  it("filters tools with readOnly mode", () => {
    const tools = [
      { name: "get-doc", slices: ["read"], annotations: { readOnlyHint: true, openWorldHint: true } },
      { name: "create-doc", slices: ["create"] },
      { name: "list-docs", slices: ["list"], isReadOnly: true },
    ];
    const config = createConfig({ readOnly: true });
    const result = filterTools(tools, "document", config);
    expect(result.map((t) => t.name)).toEqual(["get-doc", "list-docs"]);
  });
});
