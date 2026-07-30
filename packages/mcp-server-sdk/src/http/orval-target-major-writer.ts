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
 * 1. `options.major` — set explicitly in `orval.config.ts`. Always wins.
 * 2. The connected instance's `GET /umbraco/management/api/v1/server/information`,
 *    which reports a real semver. That endpoint requires authentication, so it
 *    is used when `baseUrl`/`clientId`/`clientSecret` are available (by default
 *    read from `UMBRACO_BASE_URL` / `UMBRACO_CLIENT_ID` /
 *    `UMBRACO_CLIENT_SECRET`, the same values the server itself runs on).
 * 3. The spec's `info.version`, for a committed spec file carrying a real
 *    semver (the scaffolding template's sample spec does).
 * 4. Otherwise: **throw**. A missing target major must never degrade into a
 *    stale one — that is #220's failure mode, and the version check now blocks
 *    tool execution on a mismatch.
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
import { DEFAULT_TOKEN_PATH } from "./umbraco-fetch-client.js";

/**
 * Minimal shape this transformer needs from an OpenAPI document — just
 * `info.version`. Typed structurally so the SDK needs no dependency on
 * `orval`; consumers can assign the transformer directly (or cast to orval's
 * `InputTransformerFn` if their config types require it).
 */
export type OpenApiDocumentWithInfo = { info?: { version?: unknown } };

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
 * Credentials for the authenticated `server/information` lookup.
 *
 * **You normally never construct this.** Omit the `instance` option and the
 * transformer reads `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and
 * `UMBRACO_CLIENT_SECRET` from the environment — the same three values the MCP
 * server itself runs on, so a project that can run its tools can already
 * resolve its target major with no extra config. (`orval.config.ts` must load
 * `.env` for that to work; the scaffolding template imports `src/load-env.ts`.)
 *
 * Pass this explicitly only when generation needs different credentials from the
 * ones in the environment — e.g. generating against a staging instance, or a
 * build that keeps the two in separate variables.
 */
export interface UmbracoInstanceCredentials {
  /** Base URL of the Umbraco instance, e.g. `http://localhost:56472`. */
  baseUrl: string;
  /** API user / client id used for the client-credentials token exchange. */
  clientId: string;
  /** API user / client secret. */
  clientSecret: string;
  /** Override the token endpoint path. Defaults to the Management API's. */
  tokenPath?: string;
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
  /**
   * Declare the target major explicitly instead of discovering it. Use this
   * when generation happens somewhere the instance is unreachable and the spec
   * carries no real version — an offline CI job generating from a committed
   * `"Latest"` spec, say. Takes precedence over every other source.
   */
  major?: string;
  /**
   * Credentials for the `server/information` lookup. Defaults to reading
   * `UMBRACO_BASE_URL`, `UMBRACO_CLIENT_ID` and `UMBRACO_CLIENT_SECRET` from
   * the environment; pass `false` to skip the lookup entirely (offline
   * generation from a spec that carries a real semver).
   */
  instance?: UmbracoInstanceCredentials | false;
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

/** Human-readable provenance for each source, used in the doc comment. */
const SOURCE_DESCRIPTIONS: Record<TargetMajorSource, string> = {
  explicit:
    "Declared explicitly via the transformer's `major` option in `orval.config.ts`.",
  instance:
    "Read from the Umbraco instance this server's tools were generated against,\n * via `GET /umbraco/management/api/v1/server/information`.",
  spec: "Derived from the `info.version` of the OpenAPI spec that `orval.config.ts`\n * points at.",
};

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
 * @param version - The full version string the major was derived from, included
 *   in the doc comment for traceability when it is safe to echo
 * @param source - Where the value came from. Recorded so a wrong value is
 *   diagnosable from the committed file alone.
 * @throws If `constantName` is not a valid JavaScript identifier
 */
export function renderTargetMajorModule(
  major: string,
  constantName: string = DEFAULT_TARGET_MAJOR_CONSTANT,
  version?: string,
  source: TargetMajorSource = "spec"
): string {
  if (!IDENTIFIER_PATTERN.test(constantName)) {
    throw new Error(
      `[umbraco-mcp] Invalid constantName ${JSON.stringify(constantName)}: ` +
        `must be a valid JavaScript identifier.`
    );
  }

  const derivedFrom =
    version && SAFE_VERSION_PATTERN.test(version)
      ? `\n *\n * Reported version: ${version}.`
      : "";

  return `// AUTO-GENERATED by @umbraco-cms/mcp-server-sdk's orval target-major transformer.
// Do not edit by hand — regenerate via \`npm run generate\`.
/**
 * The Umbraco major version this server's generated tools target.
 *
 * ${SOURCE_DESCRIPTIONS[source]}${derivedFrom}
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
function credentialsFromEnv(): UmbracoInstanceCredentials | null {
  const baseUrl = process.env.UMBRACO_BASE_URL?.trim();
  const clientId = process.env.UMBRACO_CLIENT_ID?.trim();
  const clientSecret = process.env.UMBRACO_CLIENT_SECRET?.trim();

  if (!baseUrl || !clientId || !clientSecret) return null;
  return { baseUrl, clientId, clientSecret };
}

/**
 * Asks a running Umbraco which version it is.
 *
 * Returns `null` rather than throwing on any failure — an unreachable instance
 * at generation time is normal (offline build, spec committed to the repo), and
 * the caller still has the spec to fall back on, then throws if that fails too.
 */
async function fetchInstanceVersion(
  credentials: UmbracoInstanceCredentials
): Promise<string | null> {
  const {
    baseUrl,
    clientId,
    clientSecret,
    tokenPath = DEFAULT_TOKEN_PATH,
  } = credentials;
  const origin = baseUrl.replace(/\/+$/, "");

  try {
    const tokenResponse = await fetch(`${origin}${tokenPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      console.warn(
        `[umbraco-mcp] Could not authenticate against ${origin} to read the target Umbraco major ` +
          `(token request returned ${tokenResponse.status} ${tokenResponse.statusText}).`
      );
      return null;
    }

    const { access_token: accessToken } = (await tokenResponse.json()) as {
      access_token?: string;
    };
    if (!accessToken) {
      console.warn(
        `[umbraco-mcp] Token response from ${origin} contained no access_token.`
      );
      return null;
    }

    const infoResponse = await fetch(`${origin}${SERVER_INFORMATION_PATH}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!infoResponse.ok) {
      console.warn(
        `[umbraco-mcp] Could not read ${SERVER_INFORMATION_PATH} from ${origin} ` +
          `(${infoResponse.status} ${infoResponse.statusText}).`
      );
      return null;
    }

    const { version } = (await infoResponse.json()) as { version?: unknown };
    if (typeof version !== "string") {
      console.warn(
        `[umbraco-mcp] ${SERVER_INFORMATION_PATH} on ${origin} returned no "version" string ` +
          `(got ${JSON.stringify(version)}).`
      );
      return null;
    }
    return version;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(
      `[umbraco-mcp] Could not reach ${origin} to read the target Umbraco major: ${reason}.`
    );
    return null;
  }
}

/** Resolves the target major from the first source that can supply one. */
async function resolveTargetMajor(
  spec: OpenApiDocumentWithInfo,
  explicitMajor: string | undefined,
  instance: UmbracoInstanceCredentials | false | undefined,
  outputPath: string,
  constantName: string
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
    return { major, source: "explicit" };
  }

  const credentials =
    instance === false ? null : (instance ?? credentialsFromEnv());

  if (credentials) {
    const version = await fetchInstanceVersion(credentials);
    const major = majorFromVersion(version);
    if (major) {
      return { major, version: version ?? undefined, source: "instance" };
    }
  }

  const specVersion =
    typeof spec?.info?.version === "string"
      ? spec.info.version.trim()
      : undefined;
  const specMajor = majorFromVersion(specVersion);

  if (specMajor) {
    if (credentials) {
      // The instance is the reliable source; a spec may belong to an add-on
      // whose `info.version` is its own release, not Umbraco's.
      console.warn(
        `[umbraco-mcp] Falling back to the spec's "info.version" (${specVersion}) for ${constantName}. ` +
          `Verify this is the Umbraco major these tools target — an add-on's spec reports the add-on's ` +
          `own version. Set the transformer's \`major\` option to pin it.`
      );
    }
    return { major: specMajor, version: specVersion, source: "spec" };
  }

  throw new Error(
    `[umbraco-mcp] Cannot determine the target Umbraco major for ${outputPath}.\n` +
      `  - The spec's "info.version" is ${JSON.stringify(spec?.info?.version)}. Every Umbraco-served ` +
      `spec hard-codes this to "Latest", so it is usually unusable.\n` +
      (credentials
        ? `  - The instance lookup via ${SERVER_INFORMATION_PATH} returned no version (see the warning above).\n`
        : `  - No instance lookup was attempted: set UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and ` +
          `UMBRACO_CLIENT_SECRET so the target major can be read from ${SERVER_INFORMATION_PATH}.\n`) +
      `  - Or declare it explicitly: createUmbracoTargetMajorTransformer({ major: "18", ... }).\n` +
      `${constantName} is required by checkUmbracoVersion, which blocks tool execution on a mismatch — ` +
      `so a wrong or stale value is worse than this error.`
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
 * @param options - Output path, optional constant name, explicit major, and
 *   instance credentials
 * @returns An orval-compatible async input transformer
 * @throws If no source yields a target major
 */
export function createUmbracoTargetMajorTransformer(
  options: UmbracoTargetMajorOptions
): <T extends OpenApiDocumentWithInfo>(spec: T) => Promise<T> {
  const {
    outputPath,
    constantName = DEFAULT_TARGET_MAJOR_CONSTANT,
    major: explicitMajor,
    instance,
  } = options;

  return async <T extends OpenApiDocumentWithInfo>(spec: T): Promise<T> => {
    const resolved = path.resolve(process.cwd(), outputPath);

    const { major, version, source } = await resolveTargetMajor(
      spec,
      explicitMajor,
      instance,
      outputPath,
      constantName
    );

    const contents = renderTargetMajorModule(
      major,
      constantName,
      version,
      source
    );

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
