import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import type { ToolCollectionExport } from "../../types/tool-collection.js";
import { toolToJsonSchema } from "../introspection.js";
import { generateContextFile } from "../context-generator.js";

function makeTool(inputSchema?: Record<string, z.ZodType>): ToolDefinition<any, any> {
  return {
    name: "test-tool",
    description: "A test tool",
    slices: ["read"],
    annotations: { readOnlyHint: true },
    inputSchema,
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  } as ToolDefinition<any, any>;
}

const shape = {
  id: z.guid().describe("The id"),
  limit: z.number().default(10),
  parent: z.string().nullable(),
  meta: z.record(z.string(), z.string()),
  when: z.date(),
};

describe("toolToJsonSchema", () => {
  const schema = toolToJsonSchema(makeTool(shape)) as any;

  it("emits $schema and never type unknown", () => {
    expect(schema.$schema).toContain("json-schema.org");
    expect(JSON.stringify(schema)).not.toContain('"unknown"');
  });

  it("maps z.guid() to string/uuid", () => {
    expect(schema.properties.id).toMatchObject({ type: "string", format: "uuid" });
  });

  it("omits defaulted fields from required", () => {
    expect(schema.required).toContain("id");
    expect(schema.required).not.toContain("limit");
  });

  it("represents nullable as anyOf with a null branch", () => {
    expect(schema.properties.parent.anyOf).toContainEqual({ type: "null" });
  });

  it("maps records to objects", () => {
    expect(schema.properties.meta.type).toBe("object");
  });

  it("gives {} for unrepresentable types without throwing", () => {
    expect(schema.properties.when).toEqual({});
  });

  it("accepts a ZodObject inputSchema without throwing", () => {
    const objSchema = toolToJsonSchema(makeTool(z.object({ id: z.guid() }) as any)) as any;
    expect(objSchema.properties.id).toMatchObject({ type: "string", format: "uuid" });
    expect(objSchema.required).toEqual(["id"]);
  });

  it("returns an empty object schema when there is no inputSchema", () => {
    expect(toolToJsonSchema(makeTool(undefined))).toEqual({ type: "object", properties: {} });
  });
});

describe("generateContextFile parameter types", () => {
  it("renders nullable as 'string | null' and unrepresentable as 'any'", () => {
    const collection: ToolCollectionExport = {
      metadata: { name: "c", displayName: "C", description: "d" },
      tools: () => [makeTool(shape)],
    };
    const out = generateContextFile([collection]);
    expect(out).toContain("`parent` (string | null, required)");
    expect(out).toContain("`when` (any, required)");
    expect(out).toContain("`id` (string, required)");
    expect(out).not.toMatch(/\((unknown)[,)]/);
  });
});
