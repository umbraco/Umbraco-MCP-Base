import { describe, it, expect } from "@jest/globals";
import { jsonSchemaToZod, jsonSchemaObjectToZodObject } from "../json-schema-to-zod.js";

describe("jsonSchemaObjectToZodObject", () => {
  it("converts a flat object schema with required and optional string properties", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string", description: "Notification ID" },
        title: { type: "string" },
      },
      required: ["id"],
    };

    const zodSchema = jsonSchemaObjectToZodObject(schema);

    expect(zodSchema.parse({ id: "n-1", title: "Hello" })).toEqual({ id: "n-1", title: "Hello" });
    expect(zodSchema.parse({ id: "n-1" })).toEqual({ id: "n-1" });
    expect(() => zodSchema.parse({ title: "Hello" })).toThrow();
  });

  it("advertises the real property names instead of an empty object", () => {
    // Regression test for the chained-tool bug: an empty inputSchema
    // ({ type: "object", properties: {} }) tells the calling client there
    // are no parameters to send, so a required argument silently never
    // reaches the handler. Converting the real schema must expose it.
    const schema = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    };

    const zodSchema = jsonSchemaObjectToZodObject(schema);
    const shape = zodSchema.shape;

    expect(Object.keys(shape)).toEqual(["id"]);
    expect(() => zodSchema.parse({})).toThrow();
  });

  it("returns an empty object schema for a tool with no parameters", () => {
    const schema = { type: "object", properties: {} };
    const zodSchema = jsonSchemaObjectToZodObject(schema);
    expect(zodSchema.parse({})).toEqual({});
  });

  it("falls back to an empty object schema for undefined input", () => {
    const zodSchema = jsonSchemaObjectToZodObject(undefined);
    expect(zodSchema.parse({})).toEqual({});
  });

  it("allows extra keys when additionalProperties is true", () => {
    const schema = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: true,
    };

    const zodSchema = jsonSchemaObjectToZodObject(schema);
    expect(zodSchema.parse({ id: "n-1", extra: "ok" })).toEqual({ id: "n-1", extra: "ok" });
  });

  it("converts nested object and array properties", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        author: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      required: ["tags", "author"],
    };

    const zodSchema = jsonSchemaObjectToZodObject(schema);
    expect(zodSchema.parse({ tags: ["a", "b"], author: { name: "Jane" } })).toEqual({
      tags: ["a", "b"],
      author: { name: "Jane" },
    });
  });
});

describe("jsonSchemaToZod", () => {
  it.each([
    ["string", { type: "string" }, "hello"],
    ["number", { type: "number" }, 3.14],
    ["integer", { type: "integer" }, 42],
    ["boolean", { type: "boolean" }, true],
  ])("converts a %s schema", (_label, schema, value) => {
    expect(jsonSchemaToZod(schema).parse(value)).toBe(value);
  });

  it("converts an enum into a literal union", () => {
    const zodSchema = jsonSchemaToZod({ enum: ["a", "b", "c"] });
    expect(zodSchema.parse("b")).toBe("b");
    expect(() => zodSchema.parse("d")).toThrow();
  });

  it("converts a single-value enum into a literal", () => {
    const zodSchema = jsonSchemaToZod({ enum: ["only"] });
    expect(zodSchema.parse("only")).toBe("only");
    expect(() => zodSchema.parse("other")).toThrow();
  });

  it("converts oneOf into a union", () => {
    const zodSchema = jsonSchemaToZod({ oneOf: [{ type: "string" }, { type: "number" }] });
    expect(zodSchema.parse("x")).toBe("x");
    expect(zodSchema.parse(1)).toBe(1);
  });

  it("converts a nullable type array", () => {
    const zodSchema = jsonSchemaToZod({ type: ["string", "null"] });
    expect(zodSchema.parse("x")).toBe("x");
    expect(zodSchema.parse(null)).toBeNull();
  });

  it("falls back to unknown for unrecognized schemas", () => {
    const zodSchema = jsonSchemaToZod({ not: { type: "string" } });
    expect(zodSchema.parse({ anything: 1 })).toEqual({ anything: 1 });
  });

  it("falls back to unknown for non-object input", () => {
    expect(jsonSchemaToZod(null).parse("anything")).toBe("anything");
  });
});
