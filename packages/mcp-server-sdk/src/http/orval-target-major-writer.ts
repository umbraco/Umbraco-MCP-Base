/**
 * Orval Target-Major Writer
 *
 * Derives the Umbraco major version an MCP server targets from the OpenAPI
 * spec its tools are generated from, and stamps it into a generated TypeScript
 * constant. The constant is then passed to `checkUmbracoVersion` at startup.
 *
 * **Why derive it instead of asking a human?** `checkUmbracoVersion` needs to
 * know which Umbraco major the tool surface was built against. Any value a
 * human types into a config file can drift, be forgotten by a downstream
 * consumer that hand-wires its own `index.ts`, or (worst case) be left at a
 * placeholder — which is how umbraco/Umbraco-MCP-Base#220 shipped a check that
 * falsely blocked the first tool call of every scaffolded server. The spec's
 * `info.version` is the honest target: it is already present in every
 * consumer's build, it is the version the generated tools actually match, and
 * regenerating against a newer Umbraco updates it automatically.
 *
 * **Why an orval input transformer?** Orval's only lifecycle hook,
 * `afterAllFilesWrite`, receives written file paths — not the spec — so it
 * cannot see `info.version`. An input transformer receives the fully parsed
 * OpenAPI document, whatever the spec source was (local YAML/JSON file or a
 * live Umbraco spec URL), so there is no second read, no URL-vs-path handling
 * and no YAML dependency. It runs on every `orval` invocation, i.e. every
 * `npm run generate`.
 *
 * @example
 * ```typescript
 * // In orval.config.ts
 * import { defineConfig, type HookFunction } from "orval";
 * import {
 *   createUmbracoTargetMajorTransformer,
 *   relaxUntypedArrays,
 * } from "@umbraco-cms/mcp-server-sdk";
 *
 * const stampTargetMajor = createUmbracoTargetMajorTransformer({
 *   outputPath: "./src/config/umbraco-target.generated.ts",
 * });
 *
 * export default defineConfig({
 *   myApi: {
 *     input: {
 *       target: "./src/umbraco-api/api/openapi.yaml",
 *       override: {
 *         // Transformers compose: stamp the constant, then relax the schemas.
 *         transformer: (spec) => stampTargetMajor(relaxUntypedArrays(spec)),
 *       },
 *     },
 *     // ... output config
 *   },
 * });
 * ```
 */

import fs from "fs";
import path from "path";

/**
 * Minimal shape this transformer needs from an OpenAPI document — just
 * `info.version`. Typed structurally so the SDK needs no dependency on
 * `orval`; consumers can assign the transformer directly (or cast to orval's
 * `InputTransformerFn` if their config types require it).
 */
export type OpenApiDocumentWithInfo = { info?: { version?: unknown } };

/** Default name of the exported constant written to the generated file. */
export const DEFAULT_TARGET_MAJOR_CONSTANT = "UMBRACO_TARGET_MAJOR";

/** Options for {@link createUmbracoTargetMajorTransformer}. */
export interface UmbracoTargetMajorOptions {
  /**
   * Where to write the generated constant, resolved against `process.cwd()`
   * (i.e. the directory `orval` / `npm run generate` runs in — the same base
   * orval itself uses for relative `output.target` paths).
   *
   * Intermediate directories are created if missing. Commit the result: a
   * freshly scaffolded project must have a working value before anyone runs
   * `generate` themselves.
   */
  outputPath: string;
  /**
   * Name of the exported constant. Defaults to `UMBRACO_TARGET_MAJOR`.
   */
  constantName?: string;
}

/**
 * Extracts the leading numeric component of an OpenAPI spec's `info.version`.
 *
 * @param spec - Parsed OpenAPI document
 * @returns The major version as a string (e.g. `"17"`), or `null` when
 *   `info.version` is absent or has no leading numeric component.
 */
export function extractSpecMajor(spec: OpenApiDocumentWithInfo): string | null {
  const version = spec?.info?.version;
  if (typeof version !== "string") return null;

  // "17.4.0" → "17", "17" → "17", " 18.0.0-rc1 " → "18".
  const match = version.trim().match(/^(\d+)/);
  return match ? match[1] : null;
}

/** Valid JavaScript/TypeScript identifier, conservatively defined. */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Conservative allow-list for the spec version echoed into the doc comment.
 * A semver-ish string only: digits, dots, dashes, plus and alphanumerics.
 */
const SAFE_SPEC_VERSION_PATTERN = /^[A-Za-z0-9.+-]{1,64}$/;

/**
 * Renders the contents of the generated constant module.
 *
 * `major` is digits-only by construction (see {@link extractSpecMajor}), so it
 * is safe to interpolate. `specVersion` comes straight from the spec — which may
 * be fetched from a remote URL — so it is echoed into the doc comment only when
 * it matches a conservative allow-list. Without that check, a version string
 * that closes the block comment early could inject arbitrary code into a
 * generated file that then gets compiled and executed.
 *
 * @param major - The Umbraco major version (e.g. `"17"`)
 * @param constantName - Name of the exported constant. Must be a valid
 *   identifier; anything else throws rather than emitting broken/unsafe code.
 * @param specVersion - The full `info.version` the major was derived from,
 *   included in the doc comment for traceability when it is safe to echo
 * @throws If `constantName` is not a valid JavaScript identifier
 */
export function renderTargetMajorModule(
  major: string,
  constantName: string = DEFAULT_TARGET_MAJOR_CONSTANT,
  specVersion?: string
): string {
  if (!IDENTIFIER_PATTERN.test(constantName)) {
    throw new Error(
      `[umbraco-mcp] Invalid constantName ${JSON.stringify(constantName)}: ` +
        `must be a valid JavaScript identifier.`
    );
  }

  const derivedFrom =
    specVersion && SAFE_SPEC_VERSION_PATTERN.test(specVersion)
      ? ` (\`info.version\`: ${specVersion})`
      : "";

  return `// AUTO-GENERATED by @umbraco-cms/mcp-server-sdk's orval target-major transformer.
// Do not edit by hand — regenerate via \`npm run generate\`.
/**
 * The Umbraco major version this server's generated tools target.
 *
 * Derived from the \`info.version\` of the OpenAPI spec that \`orval.config.ts\`
 * points at${derivedFrom}, so it always matches the tool surface that was
 * actually generated. Regenerating against a different Umbraco updates it
 * here automatically — there is nothing to keep in sync by hand.
 *
 * Passed to \`checkUmbracoVersion\` at startup. Set \`UMBRACO_EXPECTED_MAJOR\`
 * (or \`--umbraco-expected-major\`) to override it at runtime when deliberately
 * pointing at a different Umbraco major.
 */
export const ${constantName} = "${major}";
`;
}

/**
 * Creates an orval input transformer that stamps the spec's major version into
 * a generated TypeScript constant and returns the spec unchanged.
 *
 * The spec itself is **not** modified — the transformer is used purely as the
 * one orval extension point that gets to see the parsed document. Compose it
 * with other transformers (e.g. `relaxUntypedArrays`) if you need both.
 *
 * The file is only rewritten when its contents change, so repeated
 * `npm run generate` runs leave the working tree clean.
 *
 * @param options - Output path and optional constant name
 * @returns An orval-compatible input transformer
 * @throws If the spec has no usable `info.version`. Failing generation loudly
 *   is deliberate: silently writing a wrong major is exactly the failure mode
 *   (#220) this mechanism exists to prevent, and `info.version` is a *required*
 *   field in every OpenAPI version.
 */
export function createUmbracoTargetMajorTransformer(
  options: UmbracoTargetMajorOptions
): <T extends OpenApiDocumentWithInfo>(spec: T) => T {
  const { outputPath, constantName = DEFAULT_TARGET_MAJOR_CONSTANT } = options;

  return <T extends OpenApiDocumentWithInfo>(spec: T): T => {
    const major = extractSpecMajor(spec);

    if (!major) {
      throw new Error(
        `[umbraco-mcp] Cannot derive the target Umbraco major: the OpenAPI spec has no usable "info.version" ` +
          `(got ${JSON.stringify(spec?.info?.version)}). "info.version" is required by the OpenAPI ` +
          `specification and is used to stamp ${constantName} into ${outputPath}. ` +
          `Set it to the Umbraco version these tools target (e.g. "17.4.0").`
      );
    }

    const specVersion =
      typeof spec.info?.version === "string" ? spec.info.version.trim() : undefined;
    const contents = renderTargetMajorModule(major, constantName, specVersion);
    const resolved = path.resolve(process.cwd(), outputPath);

    // Only write when something actually changed, so a no-op regeneration
    // doesn't dirty the working tree (or churn file watchers).
    const existing = fs.existsSync(resolved)
      ? fs.readFileSync(resolved, "utf8")
      : null;

    if (existing !== contents) {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, contents, "utf8");
    }

    return spec;
  };
}

export default createUmbracoTargetMajorTransformer;
