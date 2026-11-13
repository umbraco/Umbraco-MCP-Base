/**
 * findUnknownArgKeys Tests
 *
 * Reports argument keys a tool's input schema doesn't declare (and a plain
 * z.object parse would silently strip), at any depth.
 */

import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import { findUnknownArgKeys } from "../unknown-arg-keys.js";

describe("findUnknownArgKeys", () => {
  it("returns nothing when every key is declared", () => {
    expect(findUnknownArgKeys({ id: z.string(), take: z.number().optional() }, { id: "a", take: 1 })).toEqual([]);
  });

  it("reports a top-level key the raw shape doesn't declare", () => {
    expect(findUnknownArgKeys({ workspaceId: z.string() }, { id: "a" })).toEqual(["id"]);
  });

  it("accepts a ZodType input schema", () => {
    expect(findUnknownArgKeys(z.object({ id: z.string() }), { id: "a", extra: 1 })).toEqual(["extra"]);
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
    expect(findUnknownArgKeys(schema, args)).toEqual(["fields[0].mandatory"]);
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
    expect(findUnknownArgKeys(schema, { settings: { message: "hi", level: 1 } })).toEqual(["settings.level"]);
  });

  it("doesn't report keys under objects that accept any key", () => {
    const schema = {
      loose: z.looseObject({ a: z.string() }),
      passthrough: z.object({ a: z.string() }).passthrough(),
      map: z.record(z.string(), z.string()),
    };
    const args = { loose: { a: "x", b: 1 }, passthrough: { a: "x", b: 1 }, map: { anything: "y" } };
    expect(findUnknownArgKeys(schema, args)).toEqual([]);
  });

  it("checks record values against the value schema", () => {
    const schema = { byCulture: z.record(z.string(), z.object({ name: z.string() })) };
    expect(findUnknownArgKeys(schema, { byCulture: { "en-US": { name: "x", title: "y" } } })).toEqual([
      "byCulture.en-US.title",
    ]);
  });

  it("reports what the best-matching union option would strip", () => {
    const schema = {
      target: z.union([z.object({ pageId: z.string() }), z.object({ segmentId: z.number(), note: z.string() })]),
    };
    expect(findUnknownArgKeys(schema, { target: { segmentId: 1, note: "n", colour: "red" } })).toEqual([
      "target.colour",
    ]);
    expect(findUnknownArgKeys(schema, { target: { pageId: "p" } })).toEqual([]);
  });

  it("isn't hidden by a scalar option in a union", () => {
    const schema = { target: z.union([z.object({ pageId: z.string() }), z.null()]) };
    expect(findUnknownArgKeys(schema, { target: { pageId: "p", extra: 1 } })).toEqual(["target.extra"]);
  });

  it("only reports keys neither side of an intersection declares", () => {
    const schema = { item: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })) };
    expect(findUnknownArgKeys(schema, { item: { a: "x", b: "y", c: "z" } })).toEqual(["item.c"]);
  });

  it("follows z.lazy schemas", () => {
    type Node = { name: string; children?: Node[] };
    const node: z.ZodType<Node> = z.lazy(() => z.object({ name: z.string(), children: z.array(node).optional() }));
    expect(findUnknownArgKeys({ root: node }, { root: { name: "a", children: [{ name: "b", kids: [] }] } })).toEqual([
      "root.children[0].kids",
    ]);
  });

  it("ignores values whose type doesn't match the schema (validation reports those)", () => {
    expect(findUnknownArgKeys({ items: z.array(z.object({ a: z.string() })) }, { items: "nope" })).toEqual([]);
    expect(findUnknownArgKeys({ id: z.string() }, null)).toEqual([]);
  });

  it("returns nothing for a tool with no input schema", () => {
    expect(findUnknownArgKeys(undefined, { anything: 1 })).toEqual([]);
  });
});
