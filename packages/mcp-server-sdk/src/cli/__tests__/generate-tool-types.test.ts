// packages/mcp-server-sdk/src/cli/__tests__/generate-tool-types.test.ts
import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import type { ToolCollectionExport } from "../../types/tool-collection.js";
import { runCodegen } from "../generate-tool-types.js";

function makeCollections(): ToolCollectionExport[] {
  const getThing: any = {
    name: "get-thing",
    description: "Gets a thing",
    inputSchema: { id: z.string().uuid() },
    outputSchema: z.object({
      id: z.string(),
      name: z.string(),
    }),
    slices: ["read"],
    handler: async () => ({ content: [] }),
  };

  const updateThing: any = {
    name: "update-thing",
    description: "Updates a thing",
    inputSchema: {
      id: z.string(),
      payload: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), value: z.string() }),
        z.object({ kind: z.literal("b"), value: z.number() }),
      ]),
    },
    slices: ["update"],
    handler: async () => ({ content: [] }),
  };

  return [
    {
      metadata: { name: "thing", displayName: "Thing", description: "" },
      tools: () => [getThing, updateThing],
    },
  ];
}

describe("runCodegen", () => {
  it("emits an interface registry covering every tool", async () => {
    const result = await runCodegen({
      collections: makeCollections(),
      registryName: "TestTools",
    });

    expect(result.skipped).toEqual([]);
    expect(result.toolsProcessed).toBe(2);
    expect(result.output).toContain("export interface GetThingInput");
    expect(result.output).toContain("export interface GetThingOutput");
    expect(result.output).toContain("export interface UpdateThingInput");
    expect(result.output).toContain("export interface TestTools {");
    expect(result.output).toContain('"get-thing": { input: GetThingInput; output: GetThingOutput };');
    expect(result.output).toContain(
      '"update-thing": { input: UpdateThingInput; output: unknown };',
    );
    expect(result.output).toContain("export type TestToolsName = keyof TestTools;");
  });

  it("supports discriminated unions in input schemas", async () => {
    const result = await runCodegen({
      collections: makeCollections(),
      registryName: "TestTools",
    });
    // discriminated union members should both appear somewhere in the .d.ts
    expect(result.output).toMatch(/kind:\s*"a"/);
    expect(result.output).toMatch(/kind:\s*"b"/);
  });

  it("falls back to Record<string, unknown> / unknown when a schema fails to convert", async () => {
    const broken: any = {
      name: "broken-tool",
      description: "Has a broken schema",
      // Intentionally pass something that is neither a ZodType nor ZodRawShape.
      inputSchema: 42 as unknown as Record<string, never>,
      slices: [],
      handler: async () => ({ content: [] }),
    };
    const collections: ToolCollectionExport[] = [
      {
        metadata: { name: "x", displayName: "x", description: "" },
        tools: () => [broken],
      },
    ];

    const result = await runCodegen({ collections, registryName: "X" });

    expect(result.toolsProcessed).toBe(1);
    expect(result.skipped.map((s) => s.tool)).toContain("broken-tool");
    expect(result.skipped[0]?.field).toBe("input");
    expect(result.output).toContain('"broken-tool": { input: Record<string, unknown>; output: unknown };');
  });

  it("throws on PascalCase type-name collision", async () => {
    const a: any = {
      name: "get-document",
      description: "",
      slices: [],
      handler: async () => ({ content: [] }),
    };
    const b: any = {
      name: "getDocument",
      description: "",
      slices: [],
      handler: async () => ({ content: [] }),
    };
    const collections: ToolCollectionExport[] = [
      {
        metadata: { name: "x", displayName: "x", description: "" },
        tools: () => [a, b],
      },
    ];

    await expect(
      runCodegen({ collections, registryName: "X" }),
    ).rejects.toThrow(/already claimed by "get-document"/);
  });

  it("calls collection.tools with the permissive user", async () => {
    const seen: unknown[] = [];
    const collections: ToolCollectionExport[] = [
      {
        metadata: { name: "x", displayName: "x", description: "" },
        tools: (user) => {
          seen.push(user);
          // Predicate that would normally fail on a permissive object —
          // only succeeds because the array proxy short-circuits.
          if ((user as any).allowedSections.includes("Umb.Section.MadeUp")) {
            return [
              {
                name: "gated-tool",
                description: "",
                slices: [],
                handler: async () => ({ content: [] }),
              } as any,
            ];
          }
          return [];
        },
      },
    ];

    const result = await runCodegen({ collections, registryName: "X" });
    expect(seen).toHaveLength(1);
    expect(result.toolsProcessed).toBe(1);
    expect(result.output).toContain('"gated-tool"');
  });
});
