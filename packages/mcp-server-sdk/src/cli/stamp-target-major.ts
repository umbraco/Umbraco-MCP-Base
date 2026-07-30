#!/usr/bin/env node
/**
 * Target-major stamp — both a library helper and a CLI binary.
 *
 * Resolves the Umbraco major an MCP server's generated tools target and writes
 * it to a committed TypeScript constant (`UMBRACO_TARGET_MAJOR`), which
 * `checkUmbracoVersion` consumes at startup. The resolution itself lives in
 * `../http/orval-target-major-writer.ts` ({@link stampTargetMajor}); this file
 * is the CLI around it.
 *
 * Binary: `umbraco-mcp-stamp-target-major --output <path> [--major <ver>]
 * [--spec <path-or-url>] [--constant-name <name>]`, chained after `orval` in a
 * project's `generate` script:
 *
 * ```json
 * "generate": "orval --config orval.config.ts && umbraco-mcp-stamp-target-major --output ./src/config/umbraco-target.generated.ts --spec ./src/umbraco-api/api/openapi.yaml"
 * ```
 *
 * This used to be an orval *input transformer*, since that was the only orval
 * extension point that could see the parsed spec. It no longer needs to be:
 * the primary source is an authenticated lookup against the running instance,
 * which needs no spec at all. As a standalone step it loads `.env` itself
 * (rather than relying on `orval.config.ts` importing it first), can be run and
 * debugged without a full codegen, and does not rest on orval `await`ing a
 * third-party hook.
 *
 * Library: {@link readSpecInfo} is exported so the spec-reading half is
 * testable on its own; everything else is re-exported from the writer module.
 */
import { stampTargetMajor } from "../http/orval-target-major-writer.js";
import type { OpenApiDocumentWithInfo } from "../http/orval-target-major-writer.js";

/** How long to wait on a remote `--spec` before giving up on the fallback. */
const SPEC_FETCH_TIMEOUT_MS = 10_000;

/**
 * Reads the `info.version` of an OpenAPI spec, from a local path or an
 * `http(s)` URL.
 *
 * Parsed with YAML in both cases: YAML 1.2 is a superset of JSON, so one code
 * path covers `.json`, `.yaml` and `.yml` — and a spec served from a URL whose
 * extension says nothing about its content.
 *
 * Returns `undefined` rather than throwing when the spec cannot be read or
 * parsed, mirroring the instance lookup: the spec is only the *last-resort*
 * source, so a missing or malformed one must not fail a run the instance can
 * still answer. If nothing else can supply a major either, the caller throws
 * with the full "cannot determine" error.
 *
 * @param source - Local file path (resolved against `process.cwd()`) or URL
 * @returns The spec's `info.version`, or `undefined` if it cannot be read
 */
export async function readSpecInfo(
  source: string
): Promise<string | undefined> {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const YAML = await import("yaml");

  let contents: string;
  try {
    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source, {
        signal: AbortSignal.timeout(SPEC_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.warn(
          `[umbraco-mcp] Could not fetch the spec at ${source} ` +
            `(${response.status} ${response.statusText}).`
        );
        return undefined;
      }
      contents = await response.text();
    } else {
      contents = readFileSync(resolve(process.cwd(), source), "utf8");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[umbraco-mcp] Could not read the spec ${source}: ${reason}.`);
    return undefined;
  }

  try {
    const parsed = YAML.parse(contents) as OpenApiDocumentWithInfo | null;
    const version = parsed?.info?.version;
    return typeof version === "string" ? version : undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[umbraco-mcp] Could not parse the spec ${source}: ${reason}.`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

const USAGE = [
  "Usage: umbraco-mcp-stamp-target-major --output <path> [options]",
  "",
  "Options:",
  "  --output <path>         Where to write the generated constant, relative to cwd (required)",
  "  --major <version>       Declare the target major explicitly; always wins",
  "  --spec <path-or-url>    OpenAPI spec to read `info.version` from as a last resort",
  "  --constant-name <name>  Name of the exported constant (default UMBRACO_TARGET_MAJOR)",
  "  -h, --help              Show this help",
  "",
  "The normal source is the connected Umbraco: set UMBRACO_BASE_URL,",
  "UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET (read from .env automatically)",
  "and the major is read from GET /umbraco/management/api/v1/server/information.",
].join("\n");

async function mainFromCli(argv: string[]): Promise<void> {
  const { parseArgs } = await import("node:util");
  // Load .env here rather than expecting the caller's config to have done it —
  // the credentials for the instance lookup live there. This self-sufficiency
  // is the point of the step being its own bin. Quiet, because dotenv 17
  // otherwise prints a banner to stdout.
  //
  // Tolerated as missing: dotenv is a dependency of every scaffolded project,
  // but a host that does not have it can still export the three variables in
  // the shell, and that should not be a hard failure.
  try {
    const { config: loadEnv } = await import("dotenv");
    loadEnv({ quiet: true });
  } catch {
    console.warn(
      "[umbraco-mcp] dotenv is not installed; reading credentials from the shell environment only."
    );
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      output: { type: "string" },
      major: { type: "string" },
      spec: { type: "string" },
      "constant-name": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const outputPath = values.output as string | undefined;
  if (!outputPath) {
    console.error(USAGE);
    throw new Error("[umbraco-mcp] --output is required.");
  }

  const specSource = values.spec as string | undefined;
  const specVersion = specSource ? await readSpecInfo(specSource) : undefined;

  const result = await stampTargetMajor(
    { info: { version: specVersion } },
    {
      outputPath,
      ...(values.major ? { major: values.major as string } : {}),
      ...(values["constant-name"]
        ? { constantName: values["constant-name"] as string }
        : {})
    }
  );

  const from = result.version ? ` (${result.version})` : "";
  console.log(
    `[umbraco-mcp] Target major "${result.major}"${from} from the ${result.source} ` +
      `→ ${result.outputPath}${result.wrote ? "" : " (unchanged)"}`
  );
}

// Detect "called as a binary" without breaking when the file is imported for
// testing. `process.argv[1]` is the script path Node was started with — when
// invoked via an npm bin shim it's the symlink path, while `import.meta.url` is
// the resolved physical path. Resolve symlinks before comparing or the CLI
// silently no-ops under `node_modules/.bin/`.
import { pathToFileURL as _pathToFileURL } from "node:url";
import { realpathSync as _realpathSync } from "node:fs";

const _isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === _pathToFileURL(_realpathSync(arg)).href;
  } catch {
    return false;
  }
})();

if (_isMain) {
  mainFromCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
