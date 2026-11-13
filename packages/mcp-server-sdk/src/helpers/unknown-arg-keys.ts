/**
 * Unknown argument keys
 *
 * A plain `z.object` strips keys it doesn't declare, so a misspelled argument
 * (`mandatory` for `required`, `id` for `workspaceId`) is dropped without a word
 * and the call goes ahead without it. `findUnknownArgKeys` walks a tool's input
 * schema alongside the raw arguments and returns the path of every key the
 * schema doesn't declare, at any depth, so a caller can say so.
 *
 * Only keys a parse would actually strip are reported: objects with a catchall
 * (`z.looseObject`, `.passthrough()`, `z.strictObject`) and `z.record` values
 * accept any key, so nothing under them is reported. A union reports what its
 * best-matching option would strip, and nothing if any option accepts every key.
 */

import { z, ZodType } from "zod";

/** Wrappers whose `_def.innerType` is the schema that actually parses the value. */
const WRAPPER_TYPES = new Set([
  "optional", "nullable", "default", "prefault", "nonoptional", "readonly", "catch",
]);

function def(schema: any): any {
  return schema?._zod?.def ?? schema?._def;
}

function unwrap(schema: any): any {
  for (let i = 0; i < 32 && schema; i++) {
    const d = def(schema);
    if (!d) return schema;
    if (WRAPPER_TYPES.has(d.type) && d.innerType) schema = d.innerType;
    else if (d.type === "pipe" && d.in) schema = d.in; // keys are checked against the input side
    else if (d.type === "lazy" && typeof d.getter === "function") schema = d.getter();
    else return schema;
  }
  return schema;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(schema: any, value: unknown, path: string, out: string[]): void {
  const inner = unwrap(schema);
  const d = def(inner);
  if (!d) return;

  switch (d.type) {
    case "object": {
      if (!isPlainObject(value)) return;
      const shape: Record<string, unknown> = d.shape ?? {};
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (Object.prototype.hasOwnProperty.call(shape, key)) {
          walk(shape[key], child, childPath, out);
        } else if (d.catchall === undefined) {
          out.push(childPath);
        }
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) return;
      value.forEach((item, i) => walk(d.element, item, `${path}[${i}]`, out));
      return;
    }
    case "tuple": {
      if (!Array.isArray(value)) return;
      value.forEach((item, i) => {
        const itemSchema = d.items?.[i] ?? d.rest;
        if (itemSchema) walk(itemSchema, item, `${path}[${i}]`, out);
      });
      return;
    }
    case "record": {
      if (!isPlainObject(value)) return;
      for (const [key, child] of Object.entries(value)) {
        walk(d.valueType, child, path ? `${path}.${key}` : key, out);
      }
      return;
    }
    case "union": {
      // Report what the best-matching option would strip. Only options that can
      // hold this kind of value are compared, so the `z.null()` in
      // `z.union([z.object(…), z.null()])` doesn't hide the object's unknown keys.
      const kinds = Array.isArray(value)
        ? ["array", "tuple", "union", "intersection"]
        : isPlainObject(value)
          ? ["object", "record", "union", "intersection"]
          : [];
      let best: string[] | undefined;
      for (const option of d.options ?? []) {
        if (!kinds.includes(def(unwrap(option))?.type)) continue;
        const optionOut: string[] = [];
        walk(option, value, path, optionOut);
        if (!best || optionOut.length < best.length) best = optionOut;
        if (best.length === 0) return;
      }
      if (best) out.push(...best);
      return;
    }
    case "intersection": {
      // A key is unknown only if neither side declares it.
      const left: string[] = [];
      const right: string[] = [];
      walk(d.left, value, path, left);
      walk(d.right, value, path, right);
      const rightSet = new Set(right);
      out.push(...left.filter((p) => rightSet.has(p)));
      return;
    }
    default:
      return;
  }
}

/**
 * Returns the path of every argument key the tool's input schema doesn't
 * declare, e.g. `["mandatory", "fields[0].colour"]`. Accepts the tool's
 * `inputSchema` as either a raw Zod shape or a Zod schema.
 */
export function findUnknownArgKeys(inputSchema: unknown, args: unknown): string[] {
  if (!inputSchema) return [];
  const schema = inputSchema instanceof ZodType || def(inputSchema)?.type
    ? inputSchema
    : z.object(inputSchema as z.ZodRawShape);
  const out: string[] = [];
  walk(schema, args, "", out);
  return out;
}
