/**
 * Orval Target-Major Writer
 *
 * Derives the Umbraco major version an MCP server targets and stamps it into a
 * generated TypeScript constant. The constant is then passed to
 * `checkUmbracoVersion` at startup.
 *
 * **Why derive it instead of asking a human?** `checkUmbracoVersion` needs to
 * know which Umbraco major the tool surface was built against. Any value a
 * human types into a config file can drift, be forgotten by a downstream
 * consumer that hand-wires its own `index.ts`, or (worst case) be left at a
 * placeholder — which is how umbraco/Umbraco-MCP-Base#220 shipped a check that
 * falsely blocked the first tool call of every scaffolded server.
 *
 * **Why not the spec's `info.version`?** Because no Umbraco spec has a usable
 * one. It is hard-coded to the literal string `"Latest"` in both
 * `ConfigureUmbracoManagementApiSwaggerGenOptions` (CMS) and the shared
 * `ConfigureUmbracoSwaggerGenOptions` that add-ons (Forms, Commerce, Deploy,
 * ...) inherit — verified on 15.x through 18.x. There is no version anywhere
 * else in the document and none in the response headers.
 *
 * An earlier revision kept `info.version` as a last-resort fallback. It was
 * removed because it could only ever do one of two things: nothing (an
 * Umbraco-served spec, i.e. every real project), or supply a number that is
 * *not* Umbraco's (a third-party or add-on spec reporting its own release —
 * which needed a warning of its own to say so). The one case where it appeared
 * to work was a hand-written sample spec, i.e. a hardcoded version wearing the
 * costume of a discovered one.
 *
 * **So there is exactly one source: the connected instance.**
 * `GET /umbraco/management/api/v1/server/information` reports a real semver. It
 * requires authentication, so `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and
 * `UMBRACO_CLIENT_SECRET` must all be set — the same values the server itself
 * runs on. If the lookup cannot answer, this **throws**: a target major must
 * never degrade into a stale or asserted one, which is #220's failure mode, and
 * the version check now blocks tool execution on a mismatch.
 *
 * There is deliberately **no way to declare the major by hand** — no option, no
 * env var, no spec fallback. You need the instance to fetch the spec anyway, so
 * anything able to generate can be asked which Umbraco it is generating
 * against. Every value this file writes was reported by a running Umbraco.
 *
 * **Why an orval input transformer?** Orval's `afterAllFilesWrite` hook
 * receives written file paths, not the spec, so it cannot see `info.version`.
 * An input transformer receives the fully parsed OpenAPI document whatever the
 * spec source was, and orval awaits it, so it can also do the authenticated
 * lookup above. It runs on every `orval` invocation, i.e. every
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
 *       // Umbraco 18+ serves the spec under /umbraco/openapi/{name}.json;
 *       // Umbraco 17 and earlier use /umbraco/swagger/{name}/swagger.json.
 *       // Either works here — the target major comes from the instance, not
 *       // this URL. See `api-spec-conventions.ts` in create-mcp-server for the
 *       // switch (OPENAPI_SWITCH_MAJOR = 18).
 *       target: "http://localhost:56472/umbraco/openapi/management.json",
 *       override: {
 *         // Transformers compose: relax the schemas, then stamp the constant.
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
import { normalizeBaseUrl } from "../helpers/url.js";
import { requestClientCredentialsToken } from "./umbraco-fetch-client.js";

/**
 * The spec is passed through untouched — this transformer never reads it. It
 * only uses the orval input-transformer slot because that is the one extension
 * point guaranteed to run as part of the same invocation that generates the
 * client, which is what keeps the constant and the tools from drifting apart.
 */
export type OpenApiDocumentPassthrough = object;

/** Default name of the exported constant written to the generated file. */
export const DEFAULT_TARGET_MAJOR_CONSTANT = "UMBRACO_TARGET_MAJOR";

/**
 * The Management API endpoint reporting the running Umbraco's version. This is
 * the only server endpoint that carries it — `server/status` and
 * `server/configuration` are anonymous but version-free, and this one requires
 * authentication.
 *
 * Unaffected by the swagger → openapi rename at Umbraco 18: that switch moved
 * the *spec document* URL (`/umbraco/swagger/{name}/swagger.json` →
 * `/umbraco/openapi/{name}.json`), while the Management API contract
 * `/umbraco/management/api/v1/...` is unchanged across it. So one path works
 * for every supported major — see `api-spec-conventions.ts` in
 * create-mcp-server, which owns that distinction.
 */
export const SERVER_INFORMATION_PATH =
  "/umbraco/management/api/v1/server/information";

/**
 * Where a value in the generated file came from.
 *
 * `instance` is the only thing the transformer produces. `placeholder` exists
 * for the value a scaffolding template commits so a fresh project compiles
 * before anyone has run `generate` — stamped via
 * {@link renderTargetMajorModule} directly, and honest about not having been
 * reported by anything. Reading the committed file tells you which you have.
 */
export type TargetMajorSource = "instance" | "placeholder";

/**
 * Credentials for the authenticated `server/information` lookup, read from the
 * environment.
 *
 * Deliberately **not** a public option. The three variables are the same ones
 * the MCP server itself runs on, so a project that can run its tools can
 * already resolve its target major with no extra config, and anything that
 * needs to override the result has `major` — a clearer knob than a second set
 * of credentials. (`orval.config.ts` must load `.env` for these to be visible;
 * the scaffolding template imports `src/load-env.ts`.)
 */
interface InstanceCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

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

/** Extracts the leading numeric component of a version string. */
function majorFromVersion(version: unknown): string | null {
  if (typeof version !== "string") return null;

  // "17.4.0" → "17", "17" → "17", " 18.0.0-rc1 " → "18", "Latest" → null.
  const match = version.trim().match(/^(\d+)/);
  return match ? match[1] : null;
}

/** Valid JavaScript/TypeScript identifier, conservatively defined. */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Conservative allow-list for the version echoed into the doc comment.
 * A semver-ish string only: digits, dots, dashes, plus and alphanumerics.
 */
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9.+-]{1,64}$/;

/**
 * Human-readable provenance for each source. Plain prose — {@link asJsDocBody}
 * adds the comment continuations, so rewording these cannot break the shape of
 * the generated file.
 */
const SOURCE_DESCRIPTIONS: Record<TargetMajorSource, string> = {
  instance:
    "Read from the Umbraco instance this server's tools were generated against, via `GET /umbraco/management/api/v1/server/information`.",
  placeholder:
    "Placeholder committed with the project scaffold so it compiles before anything has been generated. NOT reported by any Umbraco — run `npm run generate` against your instance to replace it.",
};

/** Wraps prose to ~76 columns and prefixes continuations with ` * `. */
function asJsDocBody(text: string): string {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > 74) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);

  return lines.join("\n * ");
}

/**
 * Renders the contents of the generated constant module.
 *
 * `major` is digits-only by construction (see {@link majorFromVersion}), so it
 * is safe to interpolate. `version` comes from outside — a spec that may have
 * been fetched from a remote URL, or an instance's own report — so it is echoed
 * into the doc comment only when it matches a conservative allow-list. Without
 * that check, a version string that closes the block comment early could inject
 * arbitrary code into a generated file that then gets compiled and executed.
 *
 * @param major - The Umbraco major version (e.g. `"17"`)
 * @param constantName - Name of the exported constant. Must be a valid
 *   identifier; anything else throws rather than emitting broken/unsafe code.
 * @param provenance - Where the value came from, and the version string it was
 *   derived from. Recorded so a wrong value is diagnosable from the committed
 *   file alone. Grouped into one object so adding a field later needs no new
 *   positional parameter (and no `undefined` padding at call sites).
 * @throws If `constantName` is not a valid JavaScript identifier
 */
export function renderTargetMajorModule(
  major: string,
  constantName: string = DEFAULT_TARGET_MAJOR_CONSTANT,
  provenance: { version?: string; source?: TargetMajorSource } = {}
): string {
  const { version, source = "instance" } = provenance;

  if (!IDENTIFIER_PATTERN.test(constantName)) {
    throw new Error(
      `[umbraco-mcp] Invalid constantName ${JSON.stringify(constantName)}: ` +
        `must be a valid JavaScript identifier.`
    );
  }

  const reportedVersionLine =
    version && SAFE_VERSION_PATTERN.test(version)
      ? `\n *\n * Reported version: ${version}.`
      : "";

  return `// AUTO-GENERATED by @umbraco-cms/mcp-server-sdk's orval target-major transformer.
// Do not edit by hand — regenerate via \`npm run generate\`.
/**
 * The Umbraco major version this server's generated tools target.
 *
 * ${asJsDocBody(SOURCE_DESCRIPTIONS[source])}${reportedVersionLine}
 *
 * Passed to \`checkUmbracoVersion\` at startup, which blocks tool execution when
 * the connected instance's major differs. Set \`UMBRACO_EXPECTED_MAJOR\` (or
 * \`--umbraco-expected-major\`) to override it at runtime when deliberately
 * pointing at a different Umbraco major.
 */
export const ${constantName} = "${major}";
`;
}

/** Reads instance credentials from the environment, if all three are present. */
function credentialsFromEnv(): InstanceCredentials | null {
  const baseUrl = process.env.UMBRACO_BASE_URL?.trim();
  const clientId = process.env.UMBRACO_CLIENT_ID?.trim();
  const clientSecret = process.env.UMBRACO_CLIENT_SECRET?.trim();

  if (!baseUrl || !clientId || !clientSecret) return null;
  return { baseUrl, clientId, clientSecret };
}

/**
 * How long to wait on the instance before giving up and falling back.
 *
 * Node's fetch has no overall deadline — undici's `headersTimeout`/`bodyTimeout`
 * default to 300s each — so a host that accepts the connection then goes quiet
 * (an Umbraco still booting, a stale `UMBRACO_BASE_URL` pointing at something
 * else on localhost) would stall `npm run generate` for minutes before
 * producing the same warning it produces immediately here.
 */
const INSTANCE_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Asks a running Umbraco which version it is.
 *
 * Returns `undefined` rather than throwing on any failure — an unreachable
 * instance at generation time is normal (offline build, spec committed to the
 * repo), and the caller still has the spec to fall back on, then throws if that
 * fails too. Each failure warns with its own reason: which of the two requests
 * failed, and why, is exactly what someone debugging a wrong constant needs.
 */
async function fetchInstanceVersion(
  credentials: InstanceCredentials
): Promise<string | undefined> {
  const { baseUrl, clientId, clientSecret } = credentials;
  const origin = normalizeBaseUrl(baseUrl);

  try {
    const { accessToken } = await requestClientCredentialsToken({
      baseUrl: origin,
      clientId,
      clientSecret,
      signal: AbortSignal.timeout(INSTANCE_LOOKUP_TIMEOUT_MS),
    });

    if (!accessToken) {
      console.warn(
        `[umbraco-mcp] Token response from ${origin} contained no access_token.`
      );
      return undefined;
    }

    const infoResponse = await fetch(`${origin}${SERVER_INFORMATION_PATH}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(INSTANCE_LOOKUP_TIMEOUT_MS),
    });

    if (!infoResponse.ok) {
      console.warn(
        `[umbraco-mcp] Could not read ${SERVER_INFORMATION_PATH} from ${origin} ` +
          `(${infoResponse.status} ${infoResponse.statusText}).`
      );
      return undefined;
    }

    const { version } = (await infoResponse.json()) as { version?: unknown };
    if (typeof version !== "string") {
      console.warn(
        `[umbraco-mcp] ${SERVER_INFORMATION_PATH} on ${origin} returned no "version" string ` +
          `(got ${JSON.stringify(version)}).`
      );
      return undefined;
    }
    return version;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(
      `[umbraco-mcp] Could not read the target Umbraco major from ${origin}: ${reason}.`
    );
    return undefined;
  }
}

/**
 * What {@link resolveTargetMajor} needs beyond the spec: the caller's override,
 * plus the two names that appear in its warnings and errors. Grouped so the
 * messages can grow without threading more positional parameters.
 */
interface ResolveContext {
  outputPath: string;
  constantName: string;
}

/** Resolves the target major from the first source that can supply one. */
async function resolveTargetMajor({
  outputPath,
  constantName,
}: ResolveContext): Promise<{ major: string; version: string }> {
  const credentials = credentialsFromEnv();

  if (credentials) {
    const version = await fetchInstanceVersion(credentials);
    const major = majorFromVersion(version);
    if (major && version) return { major, version };
  }

  throw new Error(
    `[umbraco-mcp] Cannot determine the target Umbraco major for ${outputPath}.\n` +
      (credentials
        ? `  - The instance lookup via ${SERVER_INFORMATION_PATH} did not return a usable version ` +
          `(see the warning above for which step failed).\n`
        : `  - No instance was configured: set UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and ` +
          `UMBRACO_CLIENT_SECRET so the major can be read from ${SERVER_INFORMATION_PATH}.\n`) +
      `The connected instance is the only source. The spec cannot supply this — every Umbraco spec ` +
      `hard-codes "info.version" to "Latest" — and there is deliberately no option, env var or ` +
      `fallback for asserting it by hand: ${constantName} is compared against a live instance by ` +
      `checkUmbracoVersion, which blocks tool execution on a mismatch, so a value nothing verified ` +
      `is worse than this error.`
  );
}

/**
 * Creates an orval input transformer that stamps the target Umbraco major into
 * a generated TypeScript constant and returns the spec unchanged.
 *
 * The spec itself is **not** modified — the transformer is used purely as the
 * one orval extension point that gets to see the parsed document. Compose it
 * with other transformers (e.g. `relaxUntypedArrays`) if you need both. Orval
 * awaits input transformers, so returning a promise is supported.
 *
 * The file is only rewritten when its contents change, so repeated
 * `npm run generate` runs leave the working tree clean.
 *
 * See the module docs for the resolution order. There is deliberately **no**
 * "keep whatever was there last time" path: a value that cannot be resolved
 * throws, because the version check blocks tool execution on a mismatch and a
 * stale constant is indistinguishable from #220's placeholder.
 *
 * @param options - Output path and optional constant name
 * @returns An orval-compatible async input transformer
 * @throws If no source yields a target major
 */
export function createUmbracoTargetMajorTransformer(
  options: UmbracoTargetMajorOptions
): <T extends OpenApiDocumentPassthrough>(spec: T) => Promise<T> {
  const { outputPath, constantName = DEFAULT_TARGET_MAJOR_CONSTANT } = options;

  return async <T extends OpenApiDocumentPassthrough>(spec: T): Promise<T> => {
    const resolved = path.resolve(process.cwd(), outputPath);

    const { major, version } = await resolveTargetMajor({
      outputPath,
      constantName,
    });

    const contents = renderTargetMajorModule(major, constantName, { version });

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
