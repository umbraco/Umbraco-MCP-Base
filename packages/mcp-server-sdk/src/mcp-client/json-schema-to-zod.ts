/**
 * JSON Schema -> Zod Conversion
 *
 * Chained MCP servers advertise tool parameters as JSON Schema (the wire
 * format), but `McpServer.registerTool()` requires a Zod schema. Without
 * converting the two, a proxied tool has to fall back to a schema with no
 * declared properties — which advertises zero parameters to the calling
 * client, so it never sends any arguments and the tool silently no-ops.
 *
 * This is a runtime converter (not codegen): it must work inside a
 * Cloudflare Worker, where `eval`/`new Function` are unavailable, which
 * rules out libraries that generate Zod source code as a string.
 *
 * Covers the JSON Schema shapes real tool parameters use in practice
 * (object/string/number/integer/boolean/array/null, enum, const,
 * oneOf/anyOf, and nested objects/arrays). Anything it can't confidently
 * model falls back to `z.unknown()` so unrecognized schemas still pass
 * arguments through rather than reject them.
 */

import { z } from "zod";

/** A JSON Schema fragment, as returned by a chained server's `tools/list`. */
export type JsonSchema = Record<string, unknown>;

function applyStringConstraints(schema: JsonSchema, zodString: z.ZodString): z.ZodTypeAny {
  let result: z.ZodTypeAny = zodString;
  if (typeof schema.minLength === "number") {
    result = (result as z.ZodString).min(schema.minLength);
  }
  if (typeof schema.maxLength === "number") {
    result = (result as z.ZodString).max(schema.maxLength);
  }
  if (typeof schema.pattern === "string") {
    result = (result as z.ZodString).regex(new RegExp(schema.pattern));
  }
  return result;
}

function applyNumberConstraints(schema: JsonSchema, zodNumber: z.ZodNumber): z.ZodTypeAny {
  let result = zodNumber;
  if (typeof schema.minimum === "number") result = result.min(schema.minimum);
  if (typeof schema.maximum === "number") result = result.max(schema.maximum);
  return result;
}

function withMetadata(schema: JsonSchema, zodType: z.ZodTypeAny): z.ZodTypeAny {
  let result = zodType;
  if (typeof schema.description === "string") {
    result = result.describe(schema.description);
  }
  if ("default" in schema) {
    result = result.default(schema.default as never);
  }
  return result;
}

/**
 * Converts a single JSON Schema fragment (a property, array item, etc.)
 * into an equivalent Zod schema.
 */
export function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.unknown();
  }
  const s = schema as JsonSchema;

  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const literals: z.ZodTypeAny[] = s.enum.map((value) => z.literal(value as never));
    const enumType =
      literals.length === 1 ? literals[0] : z.union(literals as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    return withMetadata(s, enumType);
  }

  if ("const" in s) {
    return withMetadata(s, z.literal(s.const as never));
  }

  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf)) {
    const variants = ((s.oneOf ?? s.anyOf) as JsonSchema[]).map(jsonSchemaToZod);
    if (variants.length === 0) return z.unknown();
    if (variants.length === 1) return withMetadata(s, variants[0]);
    return withMetadata(s, z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]));
  }

  const type = Array.isArray(s.type) ? s.type : s.type ? [s.type] : undefined;

  if (!type) {
    // No `type` keyword at all — most commonly an untyped/empty schema
    // (`{}`), which JSON Schema treats as "anything goes".
    if (s.properties) return jsonSchemaObjectToZodObject(s);
    return withMetadata(s, z.unknown());
  }

  const nonNullTypes = type.filter((t) => t !== "null");
  const isNullable = nonNullTypes.length !== type.length;

  const converters: Record<string, () => z.ZodTypeAny> = {
    string: () => applyStringConstraints(s, z.string()),
    number: () => applyNumberConstraints(s, z.number()),
    integer: () => applyNumberConstraints(s, z.number().int()),
    boolean: () => z.boolean(),
    null: () => z.null(),
    array: () => z.array(s.items ? jsonSchemaToZod(s.items) : z.unknown()),
    object: () => jsonSchemaObjectToZodObject(s),
  };

  const zodTypes = nonNullTypes.map((t) => converters[t as string]?.() ?? z.unknown());
  let result: z.ZodTypeAny =
    zodTypes.length === 0
      ? z.unknown()
      : zodTypes.length === 1
        ? zodTypes[0]
        : z.union(zodTypes as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);

  if (isNullable) result = result.nullable();

  return withMetadata(s, result);
}

/**
 * Converts a JSON Schema object schema (`{ type: "object", properties }`)
 * into a Zod object schema, preserving required/optional and
 * additionalProperties semantics.
 */
export function jsonSchemaObjectToZodObject(schema: unknown) {
  if (!schema || typeof schema !== "object") {
    return z.object({});
  }
  const s = schema as JsonSchema;
  const properties = (s.properties ?? {}) as Record<string, unknown>;
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);

  const shape = Object.fromEntries(
    Object.entries(properties).map(([key, propSchema]) => {
      const zodType = jsonSchemaToZod(propSchema);
      return [key, required.has(key) ? zodType : zodType.optional()];
    }),
  );

  const result = z.object(shape);
  return s.additionalProperties === true ? result.passthrough() : result;
}
