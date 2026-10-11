/**
 * Request-Scoped Umbraco Version
 *
 * The carrier that gets the connected Umbraco's version from a host that
 * knows it (it fetched `/server/information` for the version check) to tool
 * handlers and collections that gate on it.
 *
 * ## Why per request and not a module global
 *
 * One Cloudflare isolate can host Durable Object instances for *different*
 * sites, and their requests interleave. A module-level "current version"
 * would let a 17.5 site see tools that only exist on 17.6 (or the reverse)
 * because another site's request set it a moment earlier. This module rides
 * the tool call's own `context` (`RequestHandlerExtra`), the same object the
 * telemetry carrier in `telemetry/request-context.ts` uses, so the value
 * never outlives the call it belongs to.
 *
 * ## Shape
 *
 * The version is carried as the **raw string** the host read from the site
 * (e.g. `"17.6.0-rc.1"`) under one namespaced key. Parsing lives only here,
 * in {@link isAtLeast}, so every gate interprets the string the same way.
 *
 * ## Missing version
 *
 * No version means "oldest": {@link isAtLeast} returns `false`, so gates fall
 * back to their legacy variants. A failed fetch therefore never exposes an
 * endpoint the site may not have — the same conservative default stdio uses.
 */

import { toolCallExtraIndex } from "../helpers/tool-call-params.js";

/**
 * The property on the tool-call `context` (`RequestHandlerExtra`) under which
 * the connected Umbraco version travels.
 */
export const UMBRACO_VERSION_CONTEXT_KEY = "umbracoVersion";

/** Anything with the carrier attached. `RequestHandlerExtra` in practice. */
export type WithUmbracoVersionContext = {
  readonly [UMBRACO_VERSION_CONTEXT_KEY]?: string;
};

/**
 * Reads the connected Umbraco version off a tool call's `context` argument.
 *
 * Defensive rather than trusting: `context` is handed over by the MCP SDK and
 * a host may not have attached anything at all.
 *
 * @param context - The `context`/`extra` argument a tool handler received
 * @returns The raw version string, or `undefined` when none was attached
 */
export function getUmbracoVersion(context: unknown): string | undefined {
  if (typeof context !== "object" || context === null) {
    return undefined;
  }
  const carried = (context as WithUmbracoVersionContext)[UMBRACO_VERSION_CONTEXT_KEY];
  return typeof carried === "string" && carried.length > 0 ? carried : undefined;
}

/**
 * Wraps a registered tool callback so the connected Umbraco version is
 * attached to the `context`/`extra` object the MCP SDK passes it.
 *
 * Applied at registration time, by the host, once per request — exactly like
 * `withRequestTelemetryContext`. `extra`'s position is derived from the call
 * (`(args, extra)` vs `(extra)`) and the object is copied, not mutated.
 *
 * @param callback - The tool callback being registered
 * @param version - The request's raw Umbraco version; a no-op wrapper when absent
 * @returns A callback with the same signature
 */
export function withRequestUmbracoVersion<
  Callback extends (...args: any[]) => any
>(callback: Callback, version: string | undefined): Callback {
  if (typeof version !== "string" || version.length === 0) {
    return callback;
  }

  return function attachUmbracoVersion(this: unknown, ...params: any[]) {
    const extraIndex = toolCallExtraIndex(params);
    const extra = params[extraIndex];
    if (typeof extra === "object" && extra !== null) {
      params[extraIndex] = { ...extra, [UMBRACO_VERSION_CONTEXT_KEY]: version };
    }
    return callback.apply(this, params);
  } as Callback;
}

/** Leading `major.minor` of a version string; patch, prerelease and build are ignored. */
const MAJOR_MINOR = /^\s*v?(\d+)\.(\d+)(?:[.\-+\s]|$)/;

/**
 * True when `version` is at least `major.minor`.
 *
 * - `undefined`, empty or unparsable → `false` ("oldest", so gates pick their
 *   legacy variant).
 * - A prerelease counts as that version: `isAtLeast("17.6.0-rc.1", 17, 6)` is
 *   `true`, since a release candidate already ships the endpoints.
 *
 * @param version - Raw version string, e.g. from {@link getUmbracoVersion}
 * @param major - Minimum major
 * @param minor - Minimum minor
 */
export function isAtLeast(version: string | undefined, major: number, minor: number): boolean {
  if (typeof version !== "string") {
    return false;
  }
  const match = MAJOR_MINOR.exec(version);
  if (!match) {
    return false;
  }
  const actualMajor = Number(match[1]);
  const actualMinor = Number(match[2]);
  if (actualMajor !== major) {
    return actualMajor > major;
  }
  return actualMinor >= minor;
}
