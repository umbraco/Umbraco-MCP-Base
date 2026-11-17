/**
 * findStrippedArgKeys Tests
 *
 * Reports argument keys that a tool's input schema parse dropped (a plain
 * z.object silently strips keys it doesn't declare), at any depth.
 */

import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import { findStrippedArgKeys } from "../stripped-arg-keys.js";

/** Parses `args` with the schema (raw shape or ZodType) and reports what the parse dropped. */
function stripped(inputSchema: z.ZodRawShape | z.ZodType, args: unknown): string[] {
  const schema = inputSchema instanceof z.ZodType ? inputSchema : z.object(inputSchema);
  return findStrippedArgKeys(args, schema.parse(args));
}

describe("findStrippedArgKeys", () => {
  it("returns nothing when every key is declared", () => {
    expect(stripped({ id: z.string(), take: z.number().optional() }, { id: "a", take: 1 })).toEqual([]);
  });

  it("reports a top-level key the schema doesn't declare", () => {
    expect(stripped({ take: z.number().optional() }, { tke: 5 })).toEqual(["tke"]);
  });

  it("accepts a ZodType input schema", () => {
    expect(stripped(z.object({ id: z.string() }), { id: "a", extra: 1 })).toEqual(["extra"]);
  });

  it("reports keys inside array items with their index", () => {
    const schema = {
      name: z.string(),
      fields: z.array(z.object({ label: z.string(), required: z.boolean().optional() })),
    };
    const args = {
      name: "Contact",
      fields: [{ label: "Name", mandatory: true }, { label: "Email", required: true }],
    };
    expect(stripped(schema, args)).toEqual(["fields[0].mandatory"]);
  });

  it("looks through optional, nullable, default and pipe wrappers", () => {
    const schema = {
      settings: z
        .object({ message: z.string() })
        .optional()
        .nullable()
        .default({ message: "" })
        .pipe(z.object({ message: z.string() })),
    };
    expect(stripped(schema, { settings: { message: "hi", level: 1 } })).toEqual(["settings.level"]);
  });

  it("looks through z.preprocess", () => {
    const schema = { settings: z.preprocess((v) => v, z.object({ message: z.string() })) };
    expect(stripped(schema, { settings: { message: "hi", level: 1 } })).toEqual(["settings.level"]);
  });

  it("doesn't report keys the schema fills in with a default", () => {
    expect(stripped({ id: z.string(), take: z.number().default(10) }, { id: "a" })).toEqual([]);
  });

  it("doesn't report keys under objects that accept any key", () => {
    const schema = {
      loose: z.looseObject({ a: z.string() }),
      passthrough: z.object({ a: z.string() }).passthrough(),
      map: z.record(z.string(), z.string()),
    };
    const args = { loose: { a: "x", b: 1 }, passthrough: { a: "x", b: 1 }, map: { anything: "y" } };
    expect(stripped(schema, args)).toEqual([]);
  });

  it("checks record values against the value schema", () => {
    const schema = { byCulture: z.record(z.string(), z.object({ name: z.string() })) };
    expect(stripped(schema, { byCulture: { "en-US": { name: "x", title: "y" } } })).toEqual([
      "byCulture.en-US.title",
    ]);
  });

  describe("unions", () => {
    const target = z.union([
      z.object({ pageId: z.string() }),
      z.object({ segmentId: z.number(), note: z.string() }),
    ]);

    it("reports what the matching option stripped", () => {
      expect(stripped({ target }, { target: { segmentId: 1, note: "n", colour: "red" } })).toEqual([
        "target.colour",
      ]);
      expect(stripped({ target }, { target: { pageId: "p" } })).toEqual([]);
    });

    it("follows the option Zod matched, not the one declaring the most keys", () => {
      // The first option parses, so its keys are kept and the second option's are dropped
      expect(stripped({ target }, { target: { pageId: "p", segmentId: 1, note: "n" } })).toEqual([
        "target.segmentId",
        "target.note",
      ]);
    });

    it("reports keys dropped by an earlier option whose keys are all optional", () => {
      const schema = { t: z.union([z.object({ a: z.string().optional() }), z.object({ b: z.string() })]) };
      expect(stripped(schema, { t: { b: "x" } })).toEqual(["t.b"]);
    });

    it("isn't hidden by a scalar option", () => {
      const schema = { target: z.union([z.object({ pageId: z.string() }), z.null()]) };
      expect(stripped(schema, { target: { pageId: "p", extra: 1 } })).toEqual(["target.extra"]);
      expect(stripped(schema, { target: null })).toEqual([]);
    });

    it("handles discriminated unions", () => {
      const schema = {
        t: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("a"), x: z.string() }),
          z.object({ kind: z.literal("b"), y: z.string() }),
        ]),
      };
      expect(stripped(schema, { t: { kind: "a", x: "1", y: "2" } })).toEqual(["t.y"]);
    });
  });

  it("only reports keys neither side of an intersection declares", () => {
    const schema = { item: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })) };
    expect(stripped(schema, { item: { a: "x", b: "y", c: "z" } })).toEqual(["item.c"]);
  });

  it("follows z.lazy schemas", () => {
    type Node = { name: string; children?: Node[] };
    const node: z.ZodType<Node> = z.lazy(() => z.object({ name: z.string(), children: z.array(node).optional() }));
    expect(stripped({ root: node }, { root: { name: "a", children: [{ name: "b", kids: [] }] } })).toEqual([
      "root.children[0].kids",
    ]);
  });

  it("ignores values whose shape the parse changed", () => {
    expect(findStrippedArgKeys({ when: { year: 2026 } }, { when: "2026" })).toEqual([]);
    expect(findStrippedArgKeys({ ids: ["a"] }, { ids: { a: true } })).toEqual([]);
    expect(findStrippedArgKeys(null, {})).toEqual([]);
  });
});
