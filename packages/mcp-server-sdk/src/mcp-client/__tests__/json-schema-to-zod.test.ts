import { describe, it, expect } from "@jest/globals";
import { jsonSchemaObjectToZodObject } from "../json-schema-to-zod.js";

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
    expect(Object.keys((zodSchema as { shape: Record<string, unknown> }).shape)).toEqual(["id"]);
    expect(() => zodSchema.parse({})).toThrow();
  });

  it("returns an empty object schema for a tool with no parameters", () => {
    const schema = { type: "object", properties: {} };
    const zodSchema = jsonSchemaObjectToZodObject(schema);
    expect(zodSchema.parse({})).toEqual({});
  });

  it("falls back to an empty object schema for undefined input", () => {
    // z.fromJSONSchema() throws on undefined — this is the one case our
    // wrapper has to handle itself rather than delegate.
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

  it("converts an enum property", () => {
    const schema = {
      type: "object",
      properties: { status: { enum: ["open", "closed"] } },
      required: ["status"],
    };

    const zodSchema = jsonSchemaObjectToZodObject(schema);
    expect(zodSchema.parse({ status: "open" })).toEqual({ status: "open" });
    expect(() => zodSchema.parse({ status: "archived" })).toThrow();
  });
});
