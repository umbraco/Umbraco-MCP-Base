#!/usr/bin/env node
/**
 * Chained-deps codegen — both a library function and a CLI binary.
 *
 * Walks a consumer's tool source tree, extracts every literal call to a
 * chained-tool helper (default `chainCms`), and emits a TypeScript file
 * exporting the map `{ [editorToolName]: [chainedToolName, ...] }`. The map
 * is consumed at startup by `shouldIncludeTool` via the
 * `ToolFilterContext.availableChainedTools` rule — see the chained-deps
 * filtering docs in `@umbraco-cms/mcp-server-sdk` for the runtime side.
 *
 * Library: {@link generateChainedDeps} takes options, returns the file
 * content and a list of files with dynamic (non-literal) callsites that
 * the regex can't resolve.
 *
 * Binary: when invoked directly (`umbraco-mcp-generate-chained-deps`),
 * parses --src / --out / --call flags, writes the output file, and prints
 * warnings for any dynamic callsites it skipped.
 *
 * Dynamic callsites (e.g. `chainCms(tools.X, ...)`) cannot be resolved
 * statically and are reported but not gated — those tools register
 * unconditionally. If you need them gated, refactor the call to use a
 * string literal or declare `chainedDeps` inline on the tool.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Options for {@link generateChainedDeps}. */
export interface GenerateChainedDepsOptions {
  /** Root directory to walk for tool source files (e.g. "src/umbraco-api/tools"). */
  srcDir: string;
  /**
   * Name of the chained-tool helper to look for. Default `chainCms` matches
   * the convention used by Umbraco editor MCPs that wrap `@umbraco-cms/mcp-dev`.
   * Pass a different name if your project uses a different helper.
   */
  callName?: string;
  /**
   * Directory names to skip when walking. Defaults to `["__tests__", "helpers"]`.
   * Files ending in `.test.ts` are always skipped.
   */
  skipDirs?: readonly string[];
  /**
   * Name of the emitted constant. Defaults to `"CHAINED_DEPS"`.
   * Pass a different name if you re-export under a different identifier.
   */
  exportName?: string;
}

/** Result of {@link generateChainedDeps}. */
export interface GenerateChainedDepsResult {
  /** Full TypeScript file content, ready to write. */
  content: string;
  /** Map of tool name → ordered list of chained tool names. */
  deps: Record<string, string[]>;
  /**
   * Files that contained a `<callName>(<non-literal>, ...)` callsite. The
   * generator can't follow these, so any deps from them are missing from
   * `deps`. The CLI surfaces these as warnings; consumers should consider
   * refactoring to literal calls or declaring `chainedDeps` inline.
   */
  dynamicCallsites: Array<{ file: string; count: number }>;
}

interface WalkOptions {
  skipDirs: ReadonlySet<string>;
}

function walk(dir: string, opts: WalkOptions, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!opts.skipDirs.has(entry.name)) walk(p, opts, files);
    } else if (
      p.endsWith(".ts") &&
      !p.endsWith(".test.ts") &&
      !p.endsWith("index.ts")
    ) {
      files.push(p);
    }
  }
  return files;
}

/**
 * Scan a tool source tree and produce the chained-deps map.
 *
 * The default name pattern (`name: "..."`) and call pattern (`chainCms("...")`)
 * match the Umbraco MCP convention. Override `callName` for other helpers.
 */
export function generateChainedDeps(
  options: GenerateChainedDepsOptions,
): GenerateChainedDepsResult {
  const callName = options.callName ?? "chainCms";
  const skipDirs = new Set(options.skipDirs ?? ["__tests__", "helpers"]);
  const exportName = options.exportName ?? "CHAINED_DEPS";

  // Escape regex metacharacters in callName for safety.
  const escapedCall = callName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literalCall = new RegExp(`${escapedCall}\\(\\s*"([^"]+)"`, "g");
  const dynamicCall = new RegExp(`${escapedCall}\\(\\s*[^"]`, "g");
  const toolName = /name:\s*"([^"]+)"/;

  const deps: Record<string, string[]> = {};
  const dynamicCallsites: Array<{ file: string; count: number }> = [];

  for (const file of walk(options.srcDir, { skipDirs })) {
    const src = readFileSync(file, "utf-8");
    const nameMatch = src.match(toolName);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const found = new Set<string>();
    for (const m of src.matchAll(literalCall)) found.add(m[1]);

    const dynamicCount = (src.match(dynamicCall) ?? []).length;
    if (dynamicCount > 0) {
      dynamicCallsites.push({ file, count: dynamicCount });
    }

    if (found.size > 0) {
      deps[name] = [...found].sort();
    }
  }

  const sortedKeys = Object.keys(deps).sort();
  const lines = [
    "// AUTO-GENERATED — do not edit by hand.",
    `// Regenerate via \`umbraco-mcp-generate-chained-deps\` (typically wired into your build script).`,
    "// Source: @umbraco-cms/mcp-server-sdk/cli/generate-chained-deps",
    "",
    `export const ${exportName}: Record<string, readonly string[]> = {`,
  ];
  for (const k of sortedKeys) {
    const ds = deps[k].map((d) => `"${d}"`).join(", ");
    lines.push(`  "${k}": [${ds}],`);
  }
  lines.push("};");
  lines.push("");

  return { content: lines.join("\n"), deps, dynamicCallsites };
}

// ============================================================================
// CLI
// ============================================================================

function parseArg(argv: string[], name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return v;
}

function printUsage(): void {
  console.error(`Usage: umbraco-mcp-generate-chained-deps --src <dir> --out <file> [--call <name>] [--export-name <name>]

  --src         Root directory to walk for tool source files (required).
  --out         Path to write the generated TypeScript file (required).
  --call        Name of the chained-tool helper to scan for (default: chainCms).
  --export-name Name of the emitted constant (default: CHAINED_DEPS).
`);
}

// Only run the CLI body when this file is the entry point.
// Avoids executing during imports from the library function.
const isDirectEntry = import.meta.url === `file://${process.argv[1]}`;
if (isDirectEntry) {
  try {
    const srcDir = parseArg(process.argv, "--src");
    const outFile = parseArg(process.argv, "--out");
    const callName = parseArg(process.argv, "--call");
    const exportName = parseArg(process.argv, "--export-name");
    if (!srcDir || !outFile) {
      printUsage();
      process.exit(2);
    }
    const result = generateChainedDeps({
      srcDir,
      ...(callName ? { callName } : {}),
      ...(exportName ? { exportName } : {}),
    });
    writeFileSync(outFile, result.content);
    const count = Object.keys(result.deps).length;
    console.log(`Wrote ${outFile} (${count} tools with literal ${callName ?? "chainCms"} deps)`);
    if (result.dynamicCallsites.length > 0) {
      console.log(
        `\n${result.dynamicCallsites.length} file(s) with dynamic ${callName ?? "chainCms"} call(s) — those tools register unconditionally:`,
      );
      for (const w of result.dynamicCallsites) {
        console.log(`  - ${w.file}: ${w.count} dynamic call(s)`);
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
