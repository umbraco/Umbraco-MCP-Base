import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";

/**
 * Characters that have no place in a spec URL and would escape the contexts the
 * URL is written into: a double-quoted TypeScript string literal in
 * `orval.config.ts`, and a double-quoted shell argument in `package.json`'s
 * `generate` script. A real Umbraco spec URL percent-encodes all of them.
 */
const UNSAFE_URL_CHARS = /["'`$\\\s]/;

function isValidUrl(str: string): boolean {
  if (UNSAFE_URL_CHARS.test(str)) return false;
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Convert an API name like "forms-management" to a camelCase identifier like "formsManagement".
 */
function toCamelCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part, i) =>
      i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join("");
}

/**
 * Matches the `--spec <value>` argument of the template's `generate` script,
 * quoted or bare. The template ships it bare
 * (`--spec ./src/umbraco-api/api/openapi.yaml`); once repointed it is quoted,
 * so re-running `init`/`discover` has to match its own previous output too.
 */
const SPEC_ARG_PATTERN = /(--spec[ \t]+)(?:"[^"]*"|'[^']*'|[^\s"']+)/;

/**
 * Repoint the `--spec` argument of `package.json`'s `generate` script at the
 * same URL `orval.config.ts` now uses.
 *
 * `--spec` is `umbraco-mcp-stamp-target-major`'s **last-resort** source for the
 * target Umbraco major, consulted only when the authenticated instance lookup
 * cannot answer (no/invalid credentials, offline CI). Leaving it pointed at the
 * bundled sample spec — which carries a real `info.version: 17.4.0` — would let
 * a project whose credentials are broken silently stamp "17" beside tools
 * generated from an Umbraco 18 instance. That is exactly the
 * umbraco/Umbraco-MCP-Base#220 failure mode the stamp exists to prevent.
 *
 * Pointed at the live URL instead, the fallback fetches what orval itself
 * fetched: a real Umbraco spec, whose `info.version` is the hard-coded string
 * `"Latest"`. No major can be derived from it, so generation fails loudly
 * rather than committing a wrong constant.
 *
 * Best-effort by design: a customized or older `package.json` with no `--spec`
 * argument (or no readable `package.json` at all) is left alone rather than
 * failing the whole init/discover flow, mirroring how the `orval.config.ts`
 * rewrite no-ops when its pattern finds nothing.
 *
 * @returns `true` when the script was rewritten
 */
function configureGenerateSpec(projectDir: string, url: string): boolean {
  const packageJsonPath = path.join(projectDir, "package.json");

  if (!fs.existsSync(packageJsonPath)) return false;

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  } catch {
    // A malformed package.json is not this function's problem to report — the
    // orval rewrite is the contract, and the caller has already succeeded.
    return false;
  }

  const generate = pkg?.scripts?.generate;
  if (typeof generate !== "string") return false;

  const updated = generate.replace(SPEC_ARG_PATTERN, `$1"${url}"`);
  if (updated === generate) return false;

  pkg.scripts!.generate = updated;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  return true;
}

/**
 * Configure orval.config.ts with the selected API.
 * Replaces the template "exampleApi" placeholders with the actual API name and URL.
 *
 * Also repoints the `--spec` fallback in `package.json`'s `generate` script at
 * the same URL — see {@link configureGenerateSpec} for why the two must not
 * drift apart. That is a side effect, not part of the return value: the boolean
 * stays "did `orval.config.ts` change?", which is what the callers report on.
 */
export function configureOpenApi(projectDir: string, url: string, apiName?: string): boolean {
  if (!isValidUrl(url)) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  const orvalConfigPath = path.join(projectDir, "orval.config.ts");

  if (!fs.existsSync(orvalConfigPath)) {
    throw new Error(`orval.config.ts not found at ${orvalConfigPath}`);
  }

  let content = fs.readFileSync(orvalConfigPath, "utf-8");
  const original = content;

  // Derive names from the API (e.g., "forms-management" → "formsManagement")
  const camelName = apiName ? toCamelCase(apiName) : undefined;

  // Replace input targets (both the complex and simple patterns)
  content = content.replace(
    /(input:\s*\{[^}]*?target:\s*)["']([^"']+)["']/g,
    `$1"${url}"`
  );

  if (content === original) {
    content = content.replace(
      /target:\s*["']\.\/src\/umbraco-api\/api\/openapi\.yaml["']/g,
      `target: "${url}"`
    );
  }

  // Rename config keys and output filenames from "exampleApi" to the real API name
  if (camelName && camelName !== "exampleApi") {
    content = content.replace(/exampleApi/g, camelName);
  }

  // Keep the target-major fallback in step with orval's real target, whether or
  // not orval.config.ts itself needed changing (it may already be pointed at
  // this URL while package.json still carries the bundled sample spec).
  if (configureGenerateSpec(projectDir, url)) {
    console.log(pc.green(`  package.json → generate --spec "${url}"`));
  }

  if (content !== original) {
    fs.writeFileSync(orvalConfigPath, content);
    return true;
  }

  return false;
}
