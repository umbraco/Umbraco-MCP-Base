/**
 * Startup Version Check
 *
 * The Umbraco-major guard every stdio Umbraco MCP runs at startup, in one call:
 * resolve the expected major, ask the connected instance for its version under
 * a deadline, arm the one-time block on a mismatch, and hand back the message
 * for the server's `instructions`. Built from `checkUmbracoVersion`,
 * `configureVersionCheckHook` and `getVersionCheckMessage`; it adds only the
 * deadline and the chained-child skip (umbraco/Umbraco-MCP-Base#428).
 */

import { majorFromVersion } from "./major-from-version.js";
import {
  checkUmbracoVersion,
  configureVersionCheckHook,
  getVersionCheckMessage,
  sanitizeVersionCheckDetail,
  versionCheckService,
  type VersionCheckClient,
  type VersionCheckService,
} from "./check-umbraco-version.js";

/** Default deadline for the startup `server/information` lookup, token request included. */
export const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 5000;

/**
 * Env var a parent MCP server sets in a chained child's spawn env to the
 * Umbraco major its own startup guard checked against.
 *
 * The child skips its own check only when its resolved expected major is the
 * same major: the parent has already compared that major with the instance, so
 * a second check would report the same result again (and block the user twice
 * on a mismatch). A child built for a different major ignores the value and
 * runs its own check, because the parent's check says nothing about it.
 *
 * Children inherit their parent's environment, so the value can reach
 * grandchildren and can be set by hand in a client's `env` block. Neither is
 * a way to turn the guard off: only a server that targets the stated major
 * skips, and the parent only sets it for children that connect to the same
 * instance. Build the value with `chainedVersionCheckEnv`.
 */
export const PARENT_CHECKED_MAJOR_ENV = "UMBRACO_MCP_PARENT_CHECKED_MAJOR";

/**
 * The env a parent MCP server merges into a chained child's spawn env after
 * running its own startup guard, so a child that targets the same Umbraco
 * major doesn't repeat the check.
 *
 * Only set it for children that connect to the same Umbraco instance as the
 * parent.
 *
 * @param checkedUmbracoMajor - The major the parent checked against, e.g. the
 *   result of `resolveExpectedUmbracoMajor`. Anything without a numeric major
 *   gives `{}`, so the child runs its own check.
 *
 * @example
 * ```typescript
 * env: {
 *   ...chainedVersionCheckEnv(resolveExpectedUmbracoMajor(override, UMBRACO_TARGET_MAJOR)),
 * }
 * ```
 */
export function chainedVersionCheckEnv(checkedUmbracoMajor: string | null | undefined): Record<string, string> {
  const major = majorFromVersion(checkedUmbracoMajor);
  return major ? { [PARENT_CHECKED_MAJOR_ENV]: major } : {};
}

/**
 * Resolves the Umbraco major a server should check against: the override when
 * it is non-blank after trimming, otherwise the generated value.
 *
 * A blank or whitespace-only override (e.g. `UMBRACO_EXPECTED_MAJOR=` in a
 * `.env` file) falls back to the generated major, rather than reaching
 * `checkUmbracoVersion` as `""` and silently disabling the check.
 *
 * @param override - `UMBRACO_EXPECTED_MAJOR` / `--umbraco-expected-major`, as
 *   loaded by the server's config
 * @param generated - The generated `UMBRACO_TARGET_MAJOR` constant
 */
export function resolveExpectedUmbracoMajor(override: string | null | undefined, generated: string): string;
export function resolveExpectedUmbracoMajor(
  override: string | null | undefined,
  generated: string | undefined
): string | undefined;
export function resolveExpectedUmbracoMajor(
  override: string | null | undefined,
  generated: string | undefined
): string | undefined {
  const trimmed = typeof override === "string" ? override.trim() : "";
  return trimmed ? trimmed : generated;
}

/**
 * Runs `request` with an abort signal that fires after `timeoutMs`, and also
 * rejects at the deadline itself — so a request that ignores the signal still
 * cannot outlive it. The timer is always cleared, so it never keeps a process
 * (or Worker request) alive.
 *
 * @param request - Receives the signal to pass to its underlying fetch
 * @param timeoutMs - Deadline in milliseconds
 * @param label - What timed out, for the rejection message
 */
export async function withVersionCheckDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = DEFAULT_VERSION_CHECK_TIMEOUT_MS,
  label = "Umbraco server information"
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${label} did not respond within ${timeoutMs}ms, so the Umbraco version was not checked and tools are not blocked`
        )
      );
      controller.abort();
    }, timeoutMs);
  });
  try {
    // `Promise.resolve().then` turns a synchronous throw into a rejection.
    return await Promise.race([Promise.resolve().then(() => request(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Options for `runStartupVersionCheck`.
 */
export interface StartupVersionCheckOptions {
  /**
   * The expected-major override from the server's config
   * (`UMBRACO_EXPECTED_MAJOR` / `--umbraco-expected-major`). Blank falls back
   * to `generatedUmbracoMajor` (see `resolveExpectedUmbracoMajor`).
   */
  expectedUmbracoMajorOverride?: string | null;
  /** The generated `UMBRACO_TARGET_MAJOR` constant. */
  generatedUmbracoMajor: string;
  /** The MCP server's own package version (diagnostics only). */
  mcpVersion: string;
  /** Fetches `server/information`; receives the deadline's `signal`. */
  client: VersionCheckClient;
  /** Deadline for the lookup, token request included. Defaults to 5000ms. */
  timeoutMs?: number;
  /** Optional custom service instance (defaults to the singleton). */
  service?: VersionCheckService;
}

function parentCheckedSameMajor(expectedUmbracoMajor: string | undefined): boolean {
  const value = typeof process !== "undefined" ? process.env?.[PARENT_CHECKED_MAJOR_ENV] : undefined;
  const parentMajor = majorFromVersion(value);
  return parentMajor !== null && parentMajor === majorFromVersion(expectedUmbracoMajor);
}

/**
 * The stdio startup Umbraco-major guard, in one call.
 *
 * - Resolves the expected major (`resolveExpectedUmbracoMajor`).
 * - Calls `checkUmbracoVersion` with a client whose lookup is bounded by
 *   `timeoutMs` (default 5s): the signal is passed to the client and the
 *   deadline is also enforced here, for clients that ignore it. A timeout is
 *   treated like an unreachable CMS — a warning, no block.
 * - Calls `configureVersionCheckHook`, so a mismatch blocks the first
 *   decorated tool call once and a retry succeeds.
 * - Returns `getVersionCheckMessage()` for the server's `instructions`.
 *
 * When `UMBRACO_MCP_PARENT_CHECKED_MAJOR` (set by a parent server for its
 * chained child, see `chainedVersionCheckEnv`) names the same major this
 * server targets, it does nothing at all: no request, no hook, no message.
 *
 * Never throws: any unexpected failure is logged to stderr, returned as the
 * `instructions` message, and the server starts without a block.
 *
 * @returns The message for the server's `instructions`, or `null`
 *
 * @example
 * ```typescript
 * const versionCheckMessage = await runStartupVersionCheck({
 *   expectedUmbracoMajorOverride: serverConfig.custom.expectedUmbracoMajor,
 *   generatedUmbracoMajor: UMBRACO_TARGET_MAJOR,
 *   mcpVersion: packageJson.version,
 *   client: {
 *     getServerInformation: async ({ signal } = {}) => {
 *       const response = (await UmbracoManagementClient<{ version: string }>(
 *         { url: SERVER_INFORMATION_PATH, method: "GET" },
 *         { ...CAPTURE_RAW_HTTP_RESPONSE, signal },
 *       )) as unknown as HttpResponse<{ version: string }>;
 *       return { version: response.data.version };
 *     },
 *   },
 * });
 * ```
 */
export async function runStartupVersionCheck(options: StartupVersionCheckOptions): Promise<string | null> {
  const service = options?.service ?? versionCheckService;
  try {
    const expectedUmbracoMajor = resolveExpectedUmbracoMajor(
      options.expectedUmbracoMajorOverride,
      options.generatedUmbracoMajor
    );
    if (parentCheckedSameMajor(expectedUmbracoMajor)) {
      return null;
    }

    const { client, timeoutMs = DEFAULT_VERSION_CHECK_TIMEOUT_MS } = options;

    await checkUmbracoVersion({
      mcpVersion: options.mcpVersion,
      expectedUmbracoMajor,
      client: {
        getServerInformation: () =>
          withVersionCheckDeadline((signal) => client.getServerInformation({ signal }), timeoutMs),
      },
      service,
    });
    configureVersionCheckHook(service);
    return getVersionCheckMessage(service);
  } catch (error) {
    // `checkUmbracoVersion` already never throws; this covers everything
    // around it (option access, env parsing, timers, hook wiring).
    // The message goes into `instructions` too: on stdio nobody reads stderr,
    // and a guard that silently didn't run looks the same as one that passed.
    const message =
      `⚠️ Umbraco version check could not run, so the Umbraco version was not checked and tools are not blocked: ` +
      sanitizeVersionCheckDetail(error instanceof Error ? error.message : error);
    console.error(message);
    try {
      service.setBlocked(false);
    } catch {
      // Nothing more to do: never throw from startup.
    }
    return message;
  }
}
