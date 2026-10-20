// packages/mcp-server-sdk/src/cli/__tests__/introspection.test.ts
import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import { toolToJsonSchema } from "../introspection.js";
import { generateContextFile } from "../context-generator.js";
import type { ToolDefinition } from "../../types/tool-definition.js";

const tool = {
  name: "example-tool",
  description: "Example",
  inputSchema: {
    id: z.guid().describe("The id"),
    take: z.number().default(5),
    name: z.string().nullable(),
    meta: z.record(z.string(), z.string()),
    when: z.date(),
  },
  slices: [],
  annotations: {},
  handler: async () => ({ content: [] }),
} as unknown as ToolDefinition<any, any>;

describe("toolToJsonSchema", () => {
  const schema = toolToJsonSchema(tool) as any;

  it("emits a string/uuid type for z.guid() and keeps the description", () => {
    expect(schema.properties.id).toMatchObject({ type: "string", format: "uuid", description: "The id" });
  });

  it("leaves .default() fields out of required", () => {
    expect(schema.required).toEqual(expect.arrayContaining(["id", "name"]));
    expect(schema.required).not.toContain("take");
  });

  it("emits anyOf with a null branch for nullable fields", () => {
    expect(schema.properties.name.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
  });

  it("emits an object schema for z.record", () => {
    expect(schema.properties.meta.type).toBe("object");
  });

  it("gives {} for unrepresentable types instead of throwing", () => {
    expect(schema.properties.when).toEqual({});
  });

  it("never emits type: unknown and keeps $schema", () => {
    expect(JSON.stringify(schema)).not.toContain('"unknown"');
    expect(schema.$schema).toContain("2020-12");
  });

  it("returns an empty object schema when there is no inputSchema", () => {
    expect(toolToJsonSchema({ ...tool, inputSchema: undefined } as any)).toEqual({ type: "object", properties: {} });
  });
});

describe("generateContextFile parameter types", () => {
  const output = generateContextFile([
    { metadata: { name: "example", displayName: "Example", description: "", dependencies: [] }, tools: () => [tool] } as any,
  ]);

  it("shows string | null for anyOf and any for {}", () => {
    expect(output).toContain("`name` (string | null, required)");
    expect(output).toContain("`when` (any, required)");
    expect(output).not.toContain("unknown (");
  });
});
