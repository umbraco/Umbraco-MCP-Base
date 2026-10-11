/**
 * Async Request Context Store
 *
 * An `AsyncLocalStorage` holding the two request-scoped values the SDK
 * carries on a tool call's `extra` — the telemetry carrier
 * (`telemetry/request-context.ts`) and the connected Umbraco version
 * (`umbraco-version/request-context.ts`).
 *
 * ## Why it exists
 *
 * The explicit `context` argument stays the primary path. But a chained
 * in-process call is usually made from deep inside a handler by a helper that
 * never received `extra` (e.g. a `chainCms(toolName, args)` with hundreds of
 * call sites). Without a store, those calls would reach the chained handler
 * with neither version nor tenant. So the host enters this store once, at the
 * tool-call boundary — the same place it attaches the carriers to `extra` —
 * and `InProcessConnection.callTool` falls back to it when no explicit
 * `context` is passed.
 *
 * The SDK itself only *reads* the store; entering it is the host's job.
 *
 * Kept in its own file so `node:async_hooks` is only pulled in by the code
 * that actually uses it. Workers need `nodejs_compat` (or `nodejs_compat_v2`)
 * for this import.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  TELEMETRY_CONTEXT_KEY,
  getRequestTelemetryContext,
  type RequestTelemetryContext,
} from "../telemetry/request-context.js";
import {
  UMBRACO_VERSION_CONTEXT_KEY,
  getUmbracoVersion,
} from "../umbraco-version/request-context.js";

/** The request-scoped values carried across a chained in-process call. */
export interface CarriedRequestContext {
  /** Request telemetry (tenant, region, login). */
  [TELEMETRY_CONTEXT_KEY]?: Readonly<RequestTelemetryContext>;
  /** Raw connected Umbraco version. */
  [UMBRACO_VERSION_CONTEXT_KEY]?: string;
}

const store = new AsyncLocalStorage<Readonly<CarriedRequestContext>>();

/**
 * Picks only the carried, namespaced values off a tool-call `context`.
 *
 * Never copies anything else — in particular not the caller's abort signal or
 * request id — so a chained call cannot be cancelled or mis-attributed by the
 * outer call's plumbing.
 *
 * @param context - A tool call's `context`/`extra` (anything; never throws)
 * @returns A new object with whichever of the two keys are present
 */
export function pickCarriedRequestContext(context: unknown): CarriedRequestContext {
  const picked: CarriedRequestContext = {};
  const telemetry = getRequestTelemetryContext(context);
  if (telemetry) {
    picked[TELEMETRY_CONTEXT_KEY] = telemetry;
  }
  const version = getUmbracoVersion(context);
  if (version) {
    picked[UMBRACO_VERSION_CONTEXT_KEY] = version;
  }
  return picked;
}

/**
 * Runs `fn` with `values` as the active request context. Hosts call this at
 * the tool-call boundary; everything `fn` awaits sees the same values, and
 * concurrent calls each see their own.
 *
 * Only the two carried keys are stored, whatever else `values` holds, so a
 * host may pass the tool call's `extra` directly.
 *
 * @param values - The request's carried values (or a full tool-call `extra`)
 * @param fn - The work to run inside the context
 * @returns Whatever `fn` returns
 */
export function runWithRequestContext<T>(values: unknown, fn: () => T): T {
  return store.run(Object.freeze(pickCarriedRequestContext(values)), fn);
}

/**
 * The active request context entered by {@link runWithRequestContext}, or
 * `undefined` outside one.
 */
export function getActiveRequestContext(): Readonly<CarriedRequestContext> | undefined {
  return store.getStore();
}
