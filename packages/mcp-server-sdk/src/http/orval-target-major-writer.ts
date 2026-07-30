/**
 * Target-Major Writer
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
 * **Why not the spec's `info.version`?** That was the original design, and it
 * does not work against a real Umbraco. Every Umbraco Management API spec
 * hard-codes `info.version` to the literal string `"Latest"`
 * (`ConfigureUmbracoManagementApiSwaggerGenOptions` in Umbraco CMS, verified on
 * 15.x through 18.x), as does the shared `ConfigureUmbracoSwaggerGenOptions`
 * that add-ons (Forms, Commerce, Deploy, ...) inherit. There is no version
 * anywhere else in the document and none in the response headers. So a
 * spec-derived major only ever works for a committed spec file that happens to
 * carry a real semver, and silently freezes for everyone generating against a
 * live instance.
 *
 * **Where the major actually comes from**, in order:
 *
 * 1. `options.major` — declared explicitly (`--major` on the CLI). Always wins.
 * 2. The connected instance's `GET /umbraco/management/api/v1/server/information`,
 *    which reports a real semver. That endpoint requires authentication, so it
 *    is used when `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and
 *    `UMBRACO_CLIENT_SECRET` are all set — the same values the server itself
 *    runs on. Leave them unset to skip the lookup.
 * 3. The spec's `info.version`, for a committed spec file carrying a real
 *    semver (the scaffolding template's sample spec does).
 * 4. Otherwise: **throw**. A missing target major must never degrade into a
 *    stale one — that is #220's failure mode, and the version check now blocks
 *    tool execution on a mismatch.
 *
 * **Why a postgenerate CLI step?** This used to be wired as an orval *input
 * transformer*, because that was the only orval extension point that could see
 * the parsed spec (`afterAllFilesWrite` only receives file paths). Since the
 * primary source became the instance lookup, the spec is no longer needed for
 * the normal path at all — so the work moved to `umbraco-mcp-stamp-target-major`
 * (`src/cli/stamp-target-major.ts`), a bin chained after orval in the
 * template's `generate` script. That step owns its own `.env` loading, can be
 * run and debugged on its own without a full codegen, and no longer depends on
 * orval awaiting a third-party extension point. The last-resort `info.version`
 * fallback survives: the CLI reads and parses the spec itself via `--spec`.
 *
 * @example
 * ```typescript
 * import { stampTargetMajor } from "@umbraco-cms/mcp-server-sdk";
 *
 * // Same work `umbraco-mcp-stamp-target-major` does, called as a library.
 * const { major, source } = await stampTargetMajor(
 *   { info: { version: "Latest" } }, // whatever the spec says, if anything
 *   { outputPath: "./src/config/umbraco-target.generated.ts" }
 * );
 * ```
 */

import fs from "fs";
import path from "path";
import { normalizeBaseUrl } from "../helpers/url.js";
import { requestClientCredentialsToken } from "./umbraco-fetch-client.js";

/**
 * Minimal shape the resolution needs from an OpenAPI document — just
 * `info.version`. Typed structurally so the SDK needs no dependency on `orval`,
 * and so a caller that only has a version string (the CLI, which parses the
 * spec itself) can hand over `{ info: { version } }` rather than a whole
 * document.
 */
export type OpenApiDocumentWithInfo = { info?: { version?: unknown } };

/**
 * What a lazy spec provider hands back: the parsed document, or the reason it
 * could not be produced.
 *
 * The reason matters because it changes the advice in the final error. "Your
 * `--spec` path is a typo / 404s / is corrupt YAML" and "the spec was read fine
 * but every Umbraco spec says `Latest`" are different problems with different
 * fixes, and only one of them is worth explaining Umbraco's `"Latest"` quirk
 * for.
 */
export interface SpecLookupResult {
  /** The parsed document, when it could be read. */
  document?: OpenApiDocumentWithInfo;
  /** Why the spec could not be read, fetched or parsed. */
  error?: string;
  /** What the caller was pointed at, echoed into the error (`--spec`'s value). */
  source?: string;
}

/**
 * The spec argument of {@link stampTargetMajor}.
 *
 * Either a document the caller already has — the library case, and how the unit
 * tests drive it — or a **thunk**, invoked only if the spec is actually needed.
 *
 * The thunk exists because the spec is the last-resort source: an explicit
 * `major` or a working instance lookup answers first, and in those runs reading
 * the spec is pure waste (a whole extra HTTP fetch for an `http(s)` `--spec`)
 * that can also emit warnings about a file nothing consulted. A thunk is
 * therefore never invoked on those paths — including for the "instance and spec
 * disagree" warning, which only fires for an eagerly-supplied document.
 */
export type SpecProvider =
  | OpenApiDocumentWithInfo
  | (() => Promise<SpecLookupResult>);

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

/** Where a resolved target major came from, recorded in the generated file. */
export type TargetMajorSource = "explicit" | "instance" | "spec";

/**
 * Credentials for the authenticated `server/information` lookup, read from the
 * environment.
 *
 * Deliberately **not** a public option. The three variables are the same ones
 * the MCP server itself runs on, so a project that can run its tools can
 * already resolve its target major with no extra config, and anything that
 * needs to override the result has `major` — a clearer knob than a second set
 * of credentials. (`umbraco-mcp-stamp-target-major` loads `.env` itself, so the
 * normal case needs no extra wiring.)
 */
interface InstanceCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Options for {@link stampTargetMajor}. */
export interface UmbracoTargetMajorOptions {
  /**
   * Where to write the generated constant, resolved against `process.cwd()`
   * (i.e. the directory `npm run generate` runs in — the same base orval itself
   * uses for relative `output.target` paths).
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
  /**
   * Declare the target major explicitly instead of discovering it. Use this
   * when generation happens somewhere the instance is unreachable and the spec
   * carries no real version — an offline CI job generating from a committed
   * `"Latest"` spec, say. Takes precedence over every other source.
   *
   * This is the only override. To point the lookup somewhere else, set
   * `UMBRACO_BASE_URL` / `UMBRACO_CLIENT_ID` / `UMBRACO_CLIENT_SECRET` for the
   * `generate` invocation; to skip it, leave them unset.
   */
  major?: string;
}

/** Extracts the leading numeric component of a version string. */
function majorFromVersion(version: unknown): string | null {
  if (typeof version !== "string") return null;

  // "17.4.0" → "17", "17" → "17", " 18.0.0-rc1 " → "18", "Latest" → null.
  const match = version.trim().match(/^(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extracts the leading numeric component of an OpenAPI spec's `info.version`.
 *
 * Note that no Umbraco-served spec has a usable one — see the module docs. This
 * stays useful for committed spec files that carry a real semver.
 *
 * @param spec - Parsed OpenAPI document
 * @returns The major version as a string (e.g. `"17"`), or `null` when
 *   `info.version` is absent or has no leading numeric component.
 */
export function extractSpecMajor(spec: OpenApiDocumentWithInfo): string | null {
  return majorFromVersion(spec?.info?.version);
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
  explicit:
    "Declared explicitly via the `major` option (`--major` on `umbraco-mcp-stamp-target-major`).",
  instance:
    "Read from the Umbraco instance this server's tools were generated against, via `GET /umbraco/management/api/v1/server/information`.",
  spec: "Derived from the `info.version` of the OpenAPI spec passed to `umbraco-mcp-stamp-target-major` via `--spec`.",
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
  const { version, source = "spec" } = provenance;

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

  return `// AUTO-GENERATED by @umbraco-cms/mcp-server-sdk's umbraco-mcp-stamp-target-major.
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
  major?: string;
  outputPath: string;
  constantName: string;
}

/** Trimmed `info.version`, when the document carries one as a string. */
function versionFromSpec(
  spec: OpenApiDocumentWithInfo | undefined
): string | undefined {
  const version = spec?.info?.version;
  return typeof version === "string" ? version.trim() : undefined;
}

/** Resolves the target major from the first source that can supply one. */
async function resolveTargetMajor(
  spec: SpecProvider,
  { major: explicitMajor, outputPath, constantName }: ResolveContext
): Promise<{ major: string; version?: string; source: TargetMajorSource }> {
  if (explicitMajor !== undefined) {
    const major = majorFromVersion(explicitMajor);
    if (!major) {
      throw new Error(
        `[umbraco-mcp] Invalid \`major\` option ${JSON.stringify(explicitMajor)}: ` +
          `expected a version starting with a number, e.g. "18".`
      );
    }
    // No "reported version" line: nothing reported it, a human declared it.
    // Reached without ever touching the spec — a lazy provider stays uncalled.
    return { major, source: "explicit" };
  }

  // Only a document the caller already handed over is free to inspect here. A
  // lazy provider is deliberately left uninvoked until the instance lookup has
  // had its turn — see {@link SpecProvider}.
  const eagerSpec = typeof spec === "function" ? undefined : (spec ?? {});
  const credentials = credentialsFromEnv();

  if (credentials) {
    const version = await fetchInstanceVersion(credentials);
    const major = majorFromVersion(version);
    if (major) {
      // Both sources answered and disagree. The instance wins — a spec may be an
      // add-on's, reporting its own release — but this is also what a stale
      // UMBRACO_BASE_URL looks like: stamping a major the generated tools were
      // not built from. Silence here would be the same class of bug the whole
      // mechanism exists to prevent, so say it out loud.
      const eagerSpecMajor = eagerSpec ? extractSpecMajor(eagerSpec) : null;
      if (eagerSpecMajor && eagerSpecMajor !== major) {
        console.warn(
          `[umbraco-mcp] ${constantName} resolved to "${major}" from the instance at ` +
            `${normalizeBaseUrl(credentials.baseUrl)}, but the spec reports "${versionFromSpec(eagerSpec)}" ` +
            `(major "${eagerSpecMajor}"). Using the instance. If these tools were generated from that ` +
            `spec rather than that instance, one of the two is wrong — check UMBRACO_BASE_URL, or ` +
            `pin the value with the \`major\` option (\`--major\`).`
        );
      }
      return { major, version, source: "instance" };
    }
  }

  // Last resort, and only now: read the spec. For a lazy provider this is the
  // one place the file is read or the URL fetched.
  const lookup: SpecLookupResult =
    typeof spec === "function" ? await spec() : { document: eagerSpec };
  const specVersion = versionFromSpec(lookup.document);
  const specMajor = lookup.document ? extractSpecMajor(lookup.document) : null;

  if (specMajor) {
    if (credentials) {
      // The instance is the reliable source; a spec may belong to an add-on
      // whose `info.version` is its own release, not Umbraco's.
      console.warn(
        `[umbraco-mcp] Falling back to the spec's "info.version" (${specVersion}) for ${constantName}. ` +
          `Verify this is the Umbraco major these tools target — an add-on's spec reports the add-on's ` +
          `own version. Set the \`major\` option (\`--major\`) to pin it.`
      );
    }
    return { major: specMajor, version: specVersion, source: "spec" };
  }

  // Distinguish "the spec was read and has no usable version" (Umbraco's
  // `"Latest"`, the common case) from "the spec could not be read at all" (a
  // typo'd path, a 404, expired auth, corrupt YAML). Only the first is worth
  // explaining the `"Latest"` quirk for; the second needs its own reason, which
  // would otherwise survive only in a `console.warn` a truncated CI log or an
  // error tracker may well have dropped.
  const specLine = lookup.error
    ? `  - The spec${lookup.source ? ` at ${lookup.source}` : ""} could not be read: ${lookup.error}\n`
    : `  - The spec's "info.version" is ${JSON.stringify(lookup.document?.info?.version)}. Every Umbraco-served ` +
      `spec hard-codes this to "Latest", so it is usually unusable.\n`;

  throw new Error(
    `[umbraco-mcp] Cannot determine the target Umbraco major for ${outputPath}.\n` +
      specLine +
      (credentials
        ? `  - The instance lookup via ${SERVER_INFORMATION_PATH} returned no version (see the warning above).\n`
        : `  - No instance lookup was attempted: set UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and ` +
          `UMBRACO_CLIENT_SECRET so the target major can be read from ${SERVER_INFORMATION_PATH}.\n`) +
      `  - Or declare it explicitly: umbraco-mcp-stamp-target-major --major 18 ` +
      `(\`major: "18"\` when calling stampTargetMajor as a library).\n` +
      `${constantName} is required by checkUmbracoVersion, which blocks tool execution on a mismatch — ` +
      `so a wrong or stale value is worse than this error.`
  );
}

/** What {@link stampTargetMajor} resolved, and what it did with it. */
export interface StampTargetMajorResult {
  /** The resolved Umbraco major, digits only (e.g. `"18"`). */
  major: string;
  /** The full version the major came from, when a source reported one. */
  version?: string;
  /** Which source supplied the value. */
  source: TargetMajorSource;
  /** Absolute path of the generated file. */
  outputPath: string;
  /** `false` when the file was already byte-identical and was left alone. */
  wrote: boolean;
}

/**
 * Resolves the target Umbraco major and stamps it into a generated TypeScript
 * constant.
 *
 * This is the whole job of `umbraco-mcp-stamp-target-major`; the bin is a thin
 * argument-parsing wrapper around it (plus `.env` loading and reading `--spec`
 * off disk or a URL).
 *
 * The spec argument is only the **last-resort** source, so a caller with no
 * spec at all can pass `{}` — the instance lookup and the explicit `major`
 * option both work without it. A caller whose spec is expensive to obtain (the
 * CLI, which reads a file or fetches a URL) passes a thunk instead, and it is
 * invoked only on the runs that actually need it. See {@link SpecProvider}.
 *
 * The file is only rewritten when its contents change, so repeated
 * `npm run generate` runs leave the working tree clean.
 *
 * See the module docs for the resolution order. There is deliberately **no**
 * "keep whatever was there last time" path: a value that cannot be resolved
 * throws, because the version check blocks tool execution on a mismatch and a
 * stale constant is indistinguishable from #220's placeholder.
 *
 * @param spec - Anything carrying an `info.version`, `{}` when there is no
 *   spec, or a thunk resolving to one (invoked only if the spec is needed)
 * @param options - Output path, optional constant name and explicit major
 * @returns The resolved major, its provenance, and whether the file changed
 * @throws If no source yields a target major
 */
export async function stampTargetMajor(
  spec: SpecProvider,
  options: UmbracoTargetMajorOptions
): Promise<StampTargetMajorResult> {
  const {
    outputPath,
    constantName = DEFAULT_TARGET_MAJOR_CONSTANT,
    major: explicitMajor,
  } = options;

  const resolved = path.resolve(process.cwd(), outputPath);

  const { major, version, source } = await resolveTargetMajor(spec ?? {}, {
    major: explicitMajor,
    outputPath,
    constantName,
  });

  const contents = renderTargetMajorModule(major, constantName, {
    version,
    source,
  });

  // Only write when something actually changed, so a no-op regeneration
  // doesn't dirty the working tree (or churn file watchers).
  const existing = fs.existsSync(resolved)
    ? fs.readFileSync(resolved, "utf8")
    : null;
  const wrote = existing !== contents;
  if (wrote) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, contents, "utf8");
  }

  return { major, version, source, outputPath: resolved, wrote };
}
