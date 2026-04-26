# Tool-Types Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `umbraco-mcp-generate-types` CLI binary and `createPermissiveCodegenUser()` helper from `@umbraco-cms/mcp-server-sdk` so any downstream MCP can emit a typed `*Tools` registry from its built collections.

**Architecture:** Add a new TypeScript entry to the SDK at `src/cli/generate-tool-types.ts` (compiled by tsup, marked as `bin`) plus a `src/cli/permissive-user.ts` helper. The CLI loads the consumer's compiled collections via dynamic `import()`, walks every `collection.tools(permissiveUser)`, runs Zod v4's `z.toJSONSchema()` on each schema, pipes the result through `json-schema-to-typescript`, and writes a single `.d.ts` registry to disk.

**Tech Stack:** TypeScript, Zod v4 (`z.toJSONSchema`), `json-schema-to-typescript`, Node 22 `node:util.parseArgs`, tsup, jest (ESM).

---

## Issue Reference

GitHub issue: [umbraco/Umbraco-MCP-Base#65](https://github.com/umbraco/Umbraco-MCP-Base/issues/65)

Reference implementation: `scripts/generate-tool-types.mjs` in [Umbraco-CMS-MCP-Dev#168](https://github.com/umbraco/Umbraco-CMS-MCP-Dev/pull/168) (~157 LOC). The script we ship is a generalised port of that file — same Zod → JSON Schema → TS pipeline, but the user-faking moves from a hardcoded `ALL_SECTIONS` list to a Proxy-based `createPermissiveCodegenUser()`.

## File Structure

**New files:**
- `packages/mcp-server-sdk/src/cli/permissive-user.ts` — `createPermissiveCodegenUser()` Proxy helper.
- `packages/mcp-server-sdk/src/cli/__tests__/permissive-user.test.ts` — unit tests for the Proxy semantics.
- `packages/mcp-server-sdk/src/cli/generate-tool-types.ts` — CLI entry (shebang, `node:util.parseArgs`, schema walker, file writer). Has a `runCodegen()` exported function and a top-level `await runCodegen(parseArgs(...))` so it's both unit-testable and runnable as a binary.
- `packages/mcp-server-sdk/src/cli/__tests__/generate-tool-types.test.ts` — unit tests against `runCodegen()` using an in-memory fixture collection.
- `packages/mcp-server-sdk/src/cli/__tests__/fixtures/codegen-collections.mjs` — small ESM fixture that exports a `collections` array of two tools (one happy-path schema, one schema designed to trigger the per-tool fallback).

**Modified files:**
- `packages/mcp-server-sdk/package.json` — add `"bin"` entry, add `json-schema-to-typescript` dependency, add `./tool-types-cli` documentation export is **not** added (the binary is invoked via `npx`, not imported).
- `packages/mcp-server-sdk/tsup.config.ts` — add `src/cli/generate-tool-types.ts` to entries.
- `packages/mcp-server-sdk/src/cli/index.ts` — re-export `createPermissiveCodegenUser`. Do **not** export the CLI entry's `runCodegen` from here (keep it internal).
- `packages/mcp-server-sdk/src/index.ts` — re-export `createPermissiveCodegenUser` from `./cli/index.js` (it sits next to the existing `handleCliCommands` re-export).
- `packages/mcp-server-sdk/README.md` — new "Generating tool types" section.
- `package-lock.json` (root) — refreshed automatically by `npm install`.

**Out of scope (separate repos / follow-up issues):**
- Updating `Umbraco-CMS-MCP-Dev` PR 168 to consume the SDK CLI. Tracked in the issue's AC but executed in that repo, not here.
- Per-tool subpath exports (e.g. `@umbraco-cms/mcp-dev/tool-types/get-document-by-id`). The issue explicitly excludes this.

---

## Task 1: Add `createPermissiveCodegenUser()` helper (TDD)

**Why a Proxy and not an enumeration:** the reference impl in PR 168 hardcodes `ALL_SECTIONS = ["Umb.Section.Content", ...]`. When a downstream MCP adds a new section (e.g. `Umb.Section.Forms.Workflows`), the codegen silently drops every tool whose `enabled(user)` predicate checks for that section. A Proxy that intercepts `.includes`/`.some`/`.every`/`.find`/`.findIndex`/`.indexOf` and always returns truthy makes the helper insensitive to section names entirely.

**Files:**
- Create: `packages/mcp-server-sdk/src/cli/permissive-user.ts`
- Test: `packages/mcp-server-sdk/src/cli/__tests__/permissive-user.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// packages/mcp-server-sdk/src/cli/__tests__/permissive-user.test.ts
import { describe, it, expect } from "@jest/globals";
import { createPermissiveCodegenUser } from "../permissive-user.js";

describe("createPermissiveCodegenUser", () => {
  it("returns true for .includes on any property's array", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).allowedSections.includes("Umb.Section.Anything")).toBe(true);
    expect((user as any).fallbackPermissions.includes("Custom.Permission")).toBe(true);
  });

  it("returns true for .some / .every regardless of predicate", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).allowedSections.some((s: string) => s === "never-matches")).toBe(true);
    expect((user as any).fallbackPermissions.every(() => false)).toBe(true);
  });

  it("returns true for .find / .findIndex / .indexOf without enumerating values", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).fallbackPermissions.find(() => false)).toBeTruthy();
    expect((user as any).fallbackPermissions.findIndex(() => false)).toBe(0);
    expect((user as any).fallbackPermissions.indexOf("anything")).toBe(0);
  });

  it("supports nested object predicates like userGroupIds.some(g => g.id === ADMIN_KEY)", () => {
    const user = createPermissiveCodegenUser();
    const result = (user as any).userGroupIds.some(
      (g: { id: string }) => g.id.toUpperCase() === "ADMIN-KEY",
    );
    expect(result).toBe(true);
  });

  it("returns truthy for any property access on the user object", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).iAmANewSectionAddedTomorrow).toBeTruthy();
    expect((user as any).iAmANewSectionAddedTomorrow.some(() => false)).toBe(true);
  });

  it("does not enumerate any section/permission strings", async () => {
    // Read the source file as text and check no Umb.Section.* literals appear.
    // This codifies the AC: "doesn't enumerate section strings — uses Proxy or equivalent".
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "..", "permissive-user.ts"), "utf8");
    expect(src).not.toMatch(/Umb\.Section\./);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd packages/mcp-server-sdk && npx jest src/cli/__tests__/permissive-user.test.ts`
Expected: FAIL — `Cannot find module '../permissive-user.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement the helper**

```ts
// packages/mcp-server-sdk/src/cli/permissive-user.ts
import type { UserModel } from "../types/tool-definition.js";

/**
 * Returns a synthetic user that passes every authorization check that
 * tool collections may apply, regardless of which sections, permissions, or
 * group IDs the consumer's auth policies look for.
 *
 * Used only by `umbraco-mcp-generate-types` to walk every tool exported from
 * `availableCollections` so the generated `.d.ts` covers the full surface.
 */
export function createPermissiveCodegenUser(): UserModel {
  // Array predicates always succeed; index/find/indexOf return a non-empty
  // proxy so chained calls like `.find(...).id.toUpperCase()` work.
  const arrayProxyHandler: ProxyHandler<unknown[]> = {
    get(_target, prop) {
      switch (prop) {
        case "includes":
        case "some":
        case "every":
          return () => true;
        case "find":
          return () => makeArrayProxy(); // return another proxy so chained access works
        case "findIndex":
        case "indexOf":
          return () => 0;
        case "length":
          return 1;
        case Symbol.iterator:
          return function* () {
            yield makeArrayProxy();
          };
        default:
          if (prop === "0") return makeArrayProxy();
          return Reflect.get(_target, prop);
      }
    },
  };

  function makeArrayProxy(): unknown[] {
    return new Proxy([], arrayProxyHandler);
  }

  // The user itself: any property access returns an array-proxy. This means
  // `user.allowedSections.some(...)` and `user.anyFutureField.includes(...)`
  // both work without enumerating valid keys.
  const userProxyHandler: ProxyHandler<object> = {
    get(_target, prop) {
      // Don't proxy symbol-keyed access (e.g. inspect symbols) or `then`
      // (so it isn't accidentally awaited when returned from an async fn).
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return makeArrayProxy();
    },
  };

  return new Proxy({}, userProxyHandler) as UserModel;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd packages/mcp-server-sdk && npx jest src/cli/__tests__/permissive-user.test.ts`
Expected: PASS — all six tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server-sdk/src/cli/permissive-user.ts \
        packages/mcp-server-sdk/src/cli/__tests__/permissive-user.test.ts
git commit -m "feat(sdk): add createPermissiveCodegenUser helper for tool-type codegen"
```

---

## Task 2: Add `json-schema-to-typescript` dependency

**Files:**
- Modify: `packages/mcp-server-sdk/package.json`

- [ ] **Step 1: Add the dependency**

Run from repo root: `npm install --save json-schema-to-typescript@^15.0.0 -w packages/mcp-server-sdk`

- [ ] **Step 2: Verify package.json was updated**

Run: `grep '"json-schema-to-typescript"' packages/mcp-server-sdk/package.json`
Expected: a single line in `dependencies`.

- [ ] **Step 3: Verify the SDK still builds**

Run: `npm run build -w packages/mcp-server-sdk`
Expected: tsup succeeds, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server-sdk/package.json package-lock.json
git commit -m "chore(sdk): add json-schema-to-typescript dependency"
```

---

## Task 3: Implement the codegen core function (TDD against an in-memory collection)

The CLI binary in Task 4 will be a thin wrapper around a pure `runCodegen({ collections, registryName })` function. This task implements that core function and tests it directly without spawning a subprocess — much faster and easier to debug than the e2e binary test.

**Files:**
- Create: `packages/mcp-server-sdk/src/cli/generate-tool-types.ts`
- Create: `packages/mcp-server-sdk/src/cli/__tests__/generate-tool-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
    ).rejects.toThrow(/Type name collision/);
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd packages/mcp-server-sdk && npx jest src/cli/__tests__/generate-tool-types.test.ts`
Expected: FAIL — `Cannot find module '../generate-tool-types.js'`.

- [ ] **Step 3: Implement `runCodegen`**

```ts
// packages/mcp-server-sdk/src/cli/generate-tool-types.ts
import { z } from "zod";
import { compile } from "json-schema-to-typescript";
import type { ToolCollectionExport } from "../types/tool-collection.js";
import type { ToolDefinition } from "../types/tool-definition.js";
import { createPermissiveCodegenUser } from "./permissive-user.js";

export interface RunCodegenOptions {
  /** Collections to walk (already imported, not a path). */
  collections: ToolCollectionExport[];
  /** Name of the emitted registry interface (e.g. "CmsTools"). */
  registryName: string;
}

export interface SkippedSchema {
  tool: string;
  field: "input" | "output";
  err: string;
}

export interface RunCodegenResult {
  /** The full `.d.ts` file content, ready to write to disk. */
  output: string;
  /** Number of tools processed (sum across all collections). */
  toolsProcessed: number;
  /** Per-tool/per-field schema conversions that fell back to a generic type. */
  skipped: SkippedSchema[];
}

function pascal(name: string): string {
  return name
    .split(/[-_]/)
    .map((p) => (p.length === 0 ? "" : p[0].toUpperCase() + p.slice(1)))
    .join("");
}

function toJsonSchema(schemaOrShape: unknown): unknown {
  if (schemaOrShape === undefined || schemaOrShape === null) return null;
  // ZodType has a `_def`; ZodRawShape is a plain object whose values are ZodTypes.
  const wrapped =
    typeof schemaOrShape === "object" &&
    schemaOrShape !== null &&
    "_def" in (schemaOrShape as Record<string, unknown>)
      ? (schemaOrShape as z.ZodType)
      : z.object(schemaOrShape as z.ZodRawShape);
  return z.toJSONSchema(wrapped, { target: "draft-2020-12" });
}

export async function runCodegen(
  options: RunCodegenOptions,
): Promise<RunCodegenResult> {
  const { collections, registryName } = options;
  const permissiveUser = createPermissiveCodegenUser();

  // 1. Flatten tools across collections.
  const tools: ToolDefinition[] = [];
  for (const collection of collections) {
    const ts =
      typeof collection.tools === "function"
        ? collection.tools(permissiveUser)
        : (collection.tools as ToolDefinition[]);
    for (const t of ts) tools.push(t);
  }

  const lines: string[] = [
    "// AUTO-GENERATED by @umbraco-cms/mcp-server-sdk → umbraco-mcp-generate-types",
    "// Do not edit by hand. Regenerate after every build.",
    "",
  ];
  const registryEntries: string[] = [];
  const skipped: SkippedSchema[] = [];
  const seenTypeNames = new Set<string>();

  for (const tool of tools) {
    // `schema` is a deprecated alias for `inputSchema`.
    const inputSchema = toJsonSchema(
      tool.inputSchema ?? (tool as { schema?: unknown }).schema,
    );
    const outputSchema = toJsonSchema(tool.outputSchema);

    const inputTypeName = `${pascal(tool.name)}Input`;
    const outputTypeName = `${pascal(tool.name)}Output`;

    if (seenTypeNames.has(inputTypeName) || seenTypeNames.has(outputTypeName)) {
      throw new Error(
        `[tool-types] Type name collision for tool "${tool.name}". ` +
          `Two tools produce the same PascalCase type name. Rename one or prefix with collection.`,
      );
    }
    seenTypeNames.add(inputTypeName);
    seenTypeNames.add(outputTypeName);

    let inputTs = "Record<string, unknown>";
    let outputTs = "unknown";

    try {
      if (inputSchema) {
        const compiled = await compile(inputSchema as object, inputTypeName, {
          bannerComment: "",
          additionalProperties: false,
          unreachableDefinitions: true,
        });
        lines.push(compiled.trim(), "");
        inputTs = inputTypeName;
      }
    } catch (err) {
      skipped.push({
        tool: tool.name,
        field: "input",
        err: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      if (outputSchema) {
        const compiled = await compile(outputSchema as object, outputTypeName, {
          bannerComment: "",
          additionalProperties: true,
          unreachableDefinitions: true,
        });
        lines.push(compiled.trim(), "");
        outputTs = outputTypeName;
      }
    } catch (err) {
      skipped.push({
        tool: tool.name,
        field: "output",
        err: err instanceof Error ? err.message : String(err),
      });
    }

    registryEntries.push(
      `  ${JSON.stringify(tool.name)}: { input: ${inputTs}; output: ${outputTs} };`,
    );
  }

  lines.push(
    `export interface ${registryName} {`,
    ...registryEntries,
    "}",
    "",
    `export type ${registryName}Name = keyof ${registryName};`,
    "",
  );

  return {
    output: lines.join("\n"),
    toolsProcessed: tools.length,
    skipped,
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd packages/mcp-server-sdk && npx jest src/cli/__tests__/generate-tool-types.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server-sdk/src/cli/generate-tool-types.ts \
        packages/mcp-server-sdk/src/cli/__tests__/generate-tool-types.test.ts
git commit -m "feat(sdk): add runCodegen for tool-types generation"
```

---

## Task 4: Add the CLI binary wrapper

The pure `runCodegen()` is in place. Now wire it to a CLI: arg parsing via `node:util.parseArgs`, dynamic `import()` of the consumer's compiled collections, and writing the output `.d.ts` to disk.

**Files:**
- Modify: `packages/mcp-server-sdk/src/cli/generate-tool-types.ts` (append CLI entry-point at the bottom)
- Modify: `packages/mcp-server-sdk/tsup.config.ts`
- Modify: `packages/mcp-server-sdk/package.json`
- Create: `packages/mcp-server-sdk/src/cli/__tests__/fixtures/codegen-collections.mjs`

- [ ] **Step 1: Append the CLI entry to `generate-tool-types.ts`**

Add to the bottom of `packages/mcp-server-sdk/src/cli/generate-tool-types.ts`:

```ts
// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

async function mainFromCli(argv: string[]): Promise<void> {
  const { parseArgs } = await import("node:util");
  const { resolve, dirname } = await import("node:path");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");

  const { values } = parseArgs({
    args: argv,
    options: {
      collections: { type: "string", default: "./dist/collections.js" },
      out: { type: "string", default: "./dist/tool-types.d.ts" },
      "registry-name": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      [
        "Usage: umbraco-mcp-generate-types [options]",
        "",
        "Options:",
        "  --collections <path>    Path to compiled collections module (default ./dist/collections.js)",
        "  --out <path>            Output .d.ts path (default ./dist/tool-types.d.ts)",
        "  --registry-name <name>  Registry interface name (default derived from package.json name)",
        "  -h, --help              Show this help",
      ].join("\n"),
    );
    return;
  }

  const collectionsPath = resolve(process.cwd(), values.collections as string);
  const outPath = resolve(process.cwd(), values.out as string);

  // Resolve registry name. Priority: --registry-name > deriving from package.json.
  let registryName = values["registry-name"] as string | undefined;
  if (!registryName) {
    try {
      const { readFileSync } = await import("node:fs");
      const pkg = JSON.parse(
        readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
      );
      // "@umbraco-cms/mcp-cms" → "McpCmsTools" — strip scope, PascalCase, append Tools.
      const baseName = String(pkg.name ?? "Mcp").replace(/^@[^/]+\//, "");
      registryName = `${pascal(baseName)}Tools`;
    } catch {
      registryName = "Tools";
    }
  }

  // Dynamic import of the consumer's compiled collections.
  const mod = await import(pathToFileURL(collectionsPath).href);
  const collections =
    (mod as { collections?: unknown; default?: unknown }).collections ??
    (mod as { default?: unknown }).default;

  if (!Array.isArray(collections)) {
    throw new Error(
      `[tool-types] ${collectionsPath} must export a "collections" array (or default-export one). ` +
        `Got: ${typeof collections}`,
    );
  }

  const result = await runCodegen({
    collections: collections as ToolCollectionExport[],
    registryName,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.output, "utf8");

  if (result.skipped.length > 0) {
    console.warn(
      `[tool-types] ${result.skipped.length} schema(s) fell back to generic types:`,
    );
    for (const s of result.skipped) {
      console.warn(`  - ${s.tool} (${s.field}): ${s.err}`);
    }
  }
  console.log(
    `[tool-types] Wrote ${result.toolsProcessed} tools → ${outPath}`,
  );
}

// Detect "called as a binary" without breaking when the file is imported
// for testing. `process.argv[1]` is the script path Node was started with;
// `pathToFileURL` normalises it to compare with `import.meta.url`.
import { pathToFileURL as _pathToFileURL } from "node:url";

const _isMain =
  !!process.argv[1] &&
  import.meta.url === _pathToFileURL(process.argv[1]).href;

if (_isMain) {
  mainFromCli(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Also, add the shebang as the very first line of the file (above all imports):

```ts
#!/usr/bin/env node
```

- [ ] **Step 2: Add the CLI as a tsup entry**

Edit `packages/mcp-server-sdk/tsup.config.ts` and add `"src/cli/generate-tool-types.ts"` to the `entry` array. Also enable shebang preservation by adding a `banner` config — actually tsup preserves shebangs from source by default, no extra config needed. The new file:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/testing/index.ts",
    "src/evals/index.ts",
    "src/config/index.ts",
    "src/helpers/index.ts",
    "src/types/index.ts",
    "src/constants/index.ts",
    "src/cli/generate-tool-types.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    "@anthropic-ai/claude-agent-sdk",
    "@modelcontextprotocol/sdk",
    "@jest/globals",
    "dotenv",
    "yargs",
    "yargs/helpers",
    "axios",
    "qs",
    "https",
  ],
});
```

- [ ] **Step 3: Add the `bin` entry to package.json**

Edit `packages/mcp-server-sdk/package.json`. Insert a `"bin"` field directly after `"types"`:

```json
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "umbraco-mcp-generate-types": "./dist/cli/generate-tool-types.js"
  },
  "exports": {
```

- [ ] **Step 4: Build the SDK to confirm tsup emits the binary**

Run: `npm run build -w packages/mcp-server-sdk`
Expected: tsup succeeds; `packages/mcp-server-sdk/dist/cli/generate-tool-types.js` exists and starts with `#!/usr/bin/env node`.

Verify: `head -1 packages/mcp-server-sdk/dist/cli/generate-tool-types.js`
Expected: `#!/usr/bin/env node`

If the shebang is missing, add it via tsup's `banner` option:
```ts
banner: (ctx) =>
  ctx.format === "esm" && ctx.format.endsWith("esm")
    ? { js: "" }  // default
    : undefined,
```
…but the cleaner fix is to keep the shebang as line 1 of the source file. tsup preserves it.

- [ ] **Step 5: Make the binary executable**

tsup does not chmod `+x` automatically. Add a `postbuild` step OR rely on npm's `bin` install machinery (npm sets the executable bit when consumers install the package). For local invocation via `npx -w packages/mcp-server-sdk umbraco-mcp-generate-types`, npm wires it correctly. No chmod needed if always invoked through `npm run` / `npx`.

To smoke-test the binary directly without npm: `node packages/mcp-server-sdk/dist/cli/generate-tool-types.js --help`
Expected: prints the usage block from Step 1.

- [ ] **Step 6: Create the fixture collection for the binary smoke test**

```js
// packages/mcp-server-sdk/src/cli/__tests__/fixtures/codegen-collections.mjs
import { z } from "zod";

const getThing = {
  name: "get-thing",
  description: "Gets a thing",
  inputSchema: { id: z.string().uuid() },
  outputSchema: z.object({ id: z.string(), name: z.string() }),
  slices: ["read"],
  handler: async () => ({ content: [] }),
};

export const collections = [
  {
    metadata: { name: "thing", displayName: "Thing", description: "" },
    tools: () => [getThing],
  },
];
```

- [ ] **Step 7: Add a binary smoke test**

Append to `packages/mcp-server-sdk/src/cli/__tests__/generate-tool-types.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("umbraco-mcp-generate-types binary", () => {
  it("runs end-to-end against a fixture and writes a valid .d.ts", () => {
    const binPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "dist",
      "cli",
      "generate-tool-types.js",
    );
    if (!existsSync(binPath)) {
      throw new Error(
        `Binary not built. Run \`npm run build -w packages/mcp-server-sdk\` first. Looked for ${binPath}`,
      );
    }

    const fixtureDir = resolve(__dirname, "fixtures");
    const fixturePath = join(fixtureDir, "codegen-collections.mjs");
    const outDir = mkdtempSync(join(tmpdir(), "tool-types-"));
    const outPath = join(outDir, "tool-types.d.ts");

    execFileSync(
      process.execPath,
      [
        binPath,
        "--collections",
        fixturePath,
        "--out",
        outPath,
        "--registry-name",
        "FixtureTools",
      ],
      { stdio: "pipe" },
    );

    const dts = readFileSync(outPath, "utf8");
    expect(dts).toContain("export interface FixtureTools {");
    expect(dts).toContain('"get-thing"');
    expect(dts).toContain("export interface GetThingInput");
    expect(dts).toContain("export type FixtureToolsName = keyof FixtureTools;");
  });

  it("--help prints usage", () => {
    const binPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "dist",
      "cli",
      "generate-tool-types.js",
    );
    const out = execFileSync(process.execPath, [binPath, "--help"], {
      encoding: "utf8",
    });
    expect(out).toMatch(/Usage:\s+umbraco-mcp-generate-types/);
  });
});
```

- [ ] **Step 8: Run the binary smoke test**

The binary smoke test depends on `dist/`, so make sure the SDK is built:
Run: `npm run build -w packages/mcp-server-sdk && npx jest --rootDir packages/mcp-server-sdk src/cli/__tests__/generate-tool-types.test.ts`
Expected: PASS — both new "binary" tests green, plus the five existing `runCodegen` tests still pass.

- [ ] **Step 9: Commit**

```bash
git add packages/mcp-server-sdk/src/cli/generate-tool-types.ts \
        packages/mcp-server-sdk/src/cli/__tests__/generate-tool-types.test.ts \
        packages/mcp-server-sdk/src/cli/__tests__/fixtures/codegen-collections.mjs \
        packages/mcp-server-sdk/tsup.config.ts \
        packages/mcp-server-sdk/package.json
git commit -m "feat(sdk): add umbraco-mcp-generate-types CLI binary"
```

---

## Task 5: Export `createPermissiveCodegenUser` from the SDK public API

**Files:**
- Modify: `packages/mcp-server-sdk/src/cli/index.ts`
- Modify: `packages/mcp-server-sdk/src/index.ts`

- [ ] **Step 1: Re-export from the CLI module barrel**

Append to `packages/mcp-server-sdk/src/cli/index.ts`:

```ts
export { createPermissiveCodegenUser } from "./permissive-user.js";
```

- [ ] **Step 2: Re-export from the SDK root**

Edit `packages/mcp-server-sdk/src/index.ts`. Find the existing CLI re-export block:

```ts
// CLI Introspection & Context Generation
export {
  toolToJsonSchema,
  toolToSummary,
  formatToolTable,
  generateContextFile,
  handleCliCommands,
  type ToolSummary,
  type GenerateContextOptions,
  type HandleCliCommandsOptions,
} from "./cli/index.js";
```

…and add `createPermissiveCodegenUser` to the list:

```ts
// CLI Introspection & Context Generation
export {
  toolToJsonSchema,
  toolToSummary,
  formatToolTable,
  generateContextFile,
  handleCliCommands,
  createPermissiveCodegenUser,
  type ToolSummary,
  type GenerateContextOptions,
  type HandleCliCommandsOptions,
} from "./cli/index.js";
```

- [ ] **Step 3: Verify SDK builds clean and the export is present in dist**

Run: `npm run build -w packages/mcp-server-sdk`
Expected: build succeeds.

Run: `grep "createPermissiveCodegenUser" packages/mcp-server-sdk/dist/index.js packages/mcp-server-sdk/dist/index.d.ts`
Expected: matches in both files.

- [ ] **Step 4: Run the full SDK test suite**

Run: `npm run test -w packages/mcp-server-sdk`
Expected: all tests pass, including the new ones from Tasks 1, 3, and 4.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server-sdk/src/cli/index.ts packages/mcp-server-sdk/src/index.ts
git commit -m "feat(sdk): export createPermissiveCodegenUser from public API"
```

---

## Task 6: Document in the SDK README

**Files:**
- Modify: `packages/mcp-server-sdk/README.md`

- [ ] **Step 1: Add a "Generating tool types" section**

Find a sensible insertion point in `packages/mcp-server-sdk/README.md` — after the "Quick Start" but before "API Reference" — and insert:

```markdown
## Generating tool types

Downstream MCPs that chain this server's tools (via `mcpClientManager.callTool(...)`) usually want compile-time types for tool inputs and outputs. The SDK ships a CLI binary that walks your built collections and emits a single `.d.ts` registry.

### One-time setup

In your MCP package's `package.json`:

```json
{
  "scripts": {
    "build": "tsup",
    "postbuild": "umbraco-mcp-generate-types --registry-name CmsTools"
  },
  "exports": {
    "./tool-types": { "types": "./dist/tool-types.d.ts" }
  }
}
```

The defaults are:
- `--collections ./dist/collections.js` — your compiled collections module (must export a `collections` array).
- `--out ./dist/tool-types.d.ts` — output path.
- `--registry-name` — derived from `package.json`'s `name` field if omitted (e.g. `@umbraco-cms/mcp-cms` → `McpCmsTools`). Pass an explicit name to control it.

### What gets emitted

```ts
// dist/tool-types.d.ts (excerpt)
export interface GetDocumentByIdInput {
  id: string;
}
export interface GetDocumentByIdOutput {
  id: string;
  variants: { culture?: string | null; name: string }[];
  // ...
}

export interface CmsTools {
  "get-document-by-id": { input: GetDocumentByIdInput; output: GetDocumentByIdOutput };
  // ... one entry per tool
}

export type CmsToolsName = keyof CmsTools;
```

Consumers import the registry to type their chained calls:

```ts
import type { CmsTools, CmsToolsName } from "@umbraco-cms/mcp-cms/tool-types";

async function callCms<N extends CmsToolsName>(
  name: N,
  args: CmsTools[N]["input"],
): Promise<CmsTools[N]["output"]> {
  return mcpClientManager.callTool("cms", name, args) as Promise<CmsTools[N]["output"]>;
}
```

### Caveats

- Types are compile-time only. Runtime Zod validation inside each MCP remains authoritative.
- Schemas that fail to convert fall back to `Record<string, unknown>` / `unknown` — the build still succeeds and the binary logs the skipped tools at the end.
- Tool names that PascalCase to the same identifier (e.g. `get-document` and `getDocument`) are detected and the binary fails loudly. Rename one before publishing.

### Programmatic API

For tests or custom build pipelines that need to walk every tool with a permissive user:

```ts
import { createPermissiveCodegenUser } from "@umbraco-cms/mcp-server-sdk";

const tools = collections.flatMap((c) => c.tools(createPermissiveCodegenUser()));
```
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp-server-sdk/README.md
git commit -m "docs(sdk): document umbraco-mcp-generate-types CLI"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run the full SDK test suite from a clean state**

Run from repo root:
```bash
npm run build -w packages/mcp-server-sdk && npm run test -w packages/mcp-server-sdk
```
Expected: all tests pass.

- [ ] **Step 2: Run the wider test suite to confirm no regressions**

Run from repo root:
```bash
npm run test
```
Expected: all SDK tests pass (other workspaces are unaffected; their tests need only run if changed).

- [ ] **Step 3: Smoke-test the binary against the local template**

The template builds a `dist/collections.js` as part of `npm run build -w template`. Use it as a real-world target:

```bash
npm run build -w template
node packages/mcp-server-sdk/dist/cli/generate-tool-types.js \
  --collections template/dist/collections.js \
  --out /tmp/template-tool-types.d.ts \
  --registry-name TemplateTools
```
Expected: prints `[tool-types] Wrote N tools → /tmp/template-tool-types.d.ts`. Open the file and confirm it contains an `export interface TemplateTools { ... }` block. If the template has no tools, the registry will be empty but the file will still be written.

- [ ] **Step 4: Verify version files were not touched**

Run: `git diff --name-only main..HEAD | grep -E "package\.json|marketplace\.json|plugin\.json"`
Expected: only `packages/mcp-server-sdk/package.json` and `package-lock.json` (deps + bin entry). No version bumps — that happens in a release branch per `CLAUDE.md`'s release process.

- [ ] **Step 5: Cross-reference acceptance criteria from issue #65**

Walk through each AC checkbox in the issue and confirm:

| AC | Where covered |
|----|--------------|
| `createPermissiveCodegenUser()` exported, robust (no section enumeration) | Task 1 (Proxy-based), Task 5 (export). Test in Task 1 Step 1 explicitly asserts no `Umb.Section.*` literals appear in the source. |
| `umbraco-mcp-generate-types` CLI binary, `npx`-runnable | Task 4 (bin entry), Task 7 Step 3 (smoke-test). |
| Codegen tolerant to schema features in use across MCPs | Task 3 test covers discriminated unions. `z.toJSONSchema` is the same call the reference impl uses on 354 tools / 607 interfaces with 0 fallbacks. |
| Per-tool fallback when conversion fails | Task 3 test "falls back to Record<string, unknown>". |
| Type-name collision detection | Task 3 test "throws on PascalCase type-name collision". |
| Documented in SDK README | Task 6. |
| Migration: CMS-Dev PR 168 to consume the SDK CLI | **Out of scope here.** Track in CMS-Dev repo as a follow-up. |

---

## Follow-up (separate PR, separate repo)

Update [Umbraco-CMS-MCP-Dev#168](https://github.com/umbraco/Umbraco-CMS-MCP-Dev/pull/168) to:

1. Bump the `@umbraco-cms/mcp-server-sdk` dependency to the version that ships this feature.
2. Delete `scripts/generate-tool-types.mjs`.
3. Replace its `package.json` script:
   ```diff
   -  "build": "tsup && node scripts/generate-tool-types.mjs",
   +  "build": "tsup",
   +  "postbuild": "umbraco-mcp-generate-types --registry-name CmsTools"
   ```
4. Re-run the build, confirm `dist/tool-types.d.ts` is byte-identical (or close enough — diff and review) to the previous output, commit.

This is referenced from the issue's AC but lives in the CMS-Dev repo, so it isn't part of this plan.
