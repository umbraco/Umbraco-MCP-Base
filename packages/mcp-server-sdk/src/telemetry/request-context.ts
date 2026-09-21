/**
 * Request-Scoped Telemetry Context
 *
 * The carrier that gets per-request facts — which tenant, which region, which
 * login — from a host that knows them to `withTelemetry`, which doesn't.
 *
 * ## Why a carrier and not a closure
 *
 * The SDK holds the active `TelemetryAdapter` in module scope. That is safe
 * only because an adapter is a pure function with no per-request state: a
 * Cloudflare isolate can host more than one Durable Object instance, so
 * anything closed over when the adapter is built is shared by every span the
 * isolate records. Putting a tenant key there would mean spans attributed to
 * the wrong customer — the failure mode `createCloudflareTracingAdapter`
 * documents and refuses to enable.
 *
 * `mcp.session.id` already avoids this: `withTelemetry` reads
 * `context.sessionId` fresh on every tool call, into that call's own attribute
 * bag. It never outlives the call, so two interleaved calls can't see each
 * other's value. This module gives tenant/region/login the same property by
 * riding the same object.
 *
 * ## Why not `AsyncLocalStorage`
 *
 * It would work in principle — Workers support `node:async_hooks` — but the
 * natural place to enter a store (the Worker's `fetch`) is the wrong side of a
 * Durable Object boundary: tool calls execute inside the DO, reached through a
 * separate invocation that does not inherit the outer async context. The only
 * remaining place to enter a store is the tool-call boundary itself, which is
 * precisely where the context argument already is — so ALS would add a
 * `nodejs_compat` requirement for every consumer's `wrangler.toml` and buy
 * nothing.
 *
 * ## Shape
 *
 * The values are carried under one namespaced key rather than spread across
 * `context`, so nothing can collide with a field `RequestHandlerExtra` grows
 * later, and so a host attaching them is an obvious, greppable act.
 */

import type { SpanAttributes } from "./adapter.js";
import { TelemetryAttributes } from "./attributes.js";
import { toolCallExtraIndex } from "../helpers/tool-call-params.js";

/**
 * The property on the tool-call `context` (`RequestHandlerExtra`) under which
 * request-scoped telemetry values travel.
 */
export const TELEMETRY_CONTEXT_KEY = "umbracoTelemetry";

/**
 * Request-scoped values a host can attach to a tool call for telemetry.
 *
 * Every field is optional and an absent field means *absent* — the attribute
 * is simply not set. Nothing here is ever defaulted, stubbed or emitted as an
 * empty string: a missing tenant must not look like a tenant.
 */
export interface RequestTelemetryContext {
  /**
   * Opaque tenant key — a keyed hash, computed by the host. Never a plaintext
   * project alias.
   */
  tenant?: string;
  /** Hosting region in plaintext, e.g. `euwest01`. Low cardinality. */
  region?: string;
  /**
   * Opaque identifier for one login, stable across MCP reconnects. Hosts pass
   * a value that was random from birth; this is not a place to hash something
   * identifying.
   */
  loginSession?: string;
}

/** Anything with the carrier attached. `RequestHandlerExtra` in practice. */
export type WithTelemetryContext = {
  readonly [TELEMETRY_CONTEXT_KEY]?: Readonly<RequestTelemetryContext>;
};

/** True when the object carries at least one usable value. */
function isNonEmpty(value: RequestTelemetryContext): boolean {
  return Boolean(value.tenant || value.region || value.loginSession);
}

/**
 * Validates and freezes a telemetry context once, so a caller wrapping many
 * tool handlers for the same request — `registerCollectionTools`, one call
 * per registered tool — can reuse the result instead of paying the
 * `isNonEmpty` check and the freeze allocation again for every tool.
 *
 * @param telemetry - The request's raw values
 * @returns The frozen carrier, or `undefined` for the no-op case (matches
 *   `withRequestTelemetryContext`'s own short-circuit)
 */
export function prepareRequestTelemetryContext(
  telemetry: RequestTelemetryContext | undefined
): Readonly<RequestTelemetryContext> | undefined {
  if (!telemetry || !isNonEmpty(telemetry)) {
    return undefined;
  }
  // Frozen for the reasons `withRequestTelemetryContext` documents below —
  // copied so later mutation of the host's object can't retroactively change
  // calls already in flight.
  return Object.freeze({ ...telemetry });
}

/**
 * Reads the carrier off a tool call's `context` argument.
 *
 * Defensive rather than trusting: `context` is handed over by the MCP SDK and
 * a host may not have attached anything at all.
 *
 * @param context - The `context`/`extra` argument a tool handler received
 * @returns The attached values, or `undefined` when there are none
 */
export function getRequestTelemetryContext(
  context: unknown
): Readonly<RequestTelemetryContext> | undefined {
  if (typeof context !== "object" || context === null) {
    return undefined;
  }
  const carried = (context as WithTelemetryContext)[TELEMETRY_CONTEXT_KEY];
  if (typeof carried !== "object" || carried === null) {
    return undefined;
  }
  return carried;
}

/**
 * Copies whichever request-scoped values are present onto a span attribute
 * bag. Absent values are left unset — never `""`, never `"unknown"`.
 *
 * @param attributes - The per-call attribute bag to write into (mutated)
 * @param context - The tool call's `context` argument
 */
export function applyRequestTelemetryAttributes(
  attributes: SpanAttributes,
  context: unknown
): void {
  const carried = getRequestTelemetryContext(context);
  if (!carried) {
    return;
  }
  if (typeof carried.tenant === "string" && carried.tenant.length > 0) {
    attributes[TelemetryAttributes.TENANT] = carried.tenant;
  }
  if (typeof carried.region === "string" && carried.region.length > 0) {
    attributes[TelemetryAttributes.REGION] = carried.region;
  }
  if (typeof carried.loginSession === "string" && carried.loginSession.length > 0) {
    attributes[TelemetryAttributes.LOGIN_SESSION] = carried.loginSession;
  }
}

/**
 * Wraps a registered tool callback so the carrier is attached to the
 * `context`/`extra` object the MCP SDK passes it.
 *
 * Meant to be applied at *registration* time, by the host, once per request —
 * so the values it closes over belong to that one request's `McpServer` and
 * nothing else. That is the whole point: the closure's lifetime is the
 * request's, not the isolate's.
 *
 * The MCP SDK invokes a tool callback as `(args, extra)` when the tool
 * declares an `inputSchema` and as `(extra)` when it doesn't, so the position
 * of `extra` is derived from the call the same way rather than assumed. The
 * object is copied, not mutated — the SDK owns it, and a copy keeps this from
 * being observable to anything else holding a reference.
 *
 * @param callback - The tool callback being registered
 * @param telemetry - The request's values (raw, or already run through
 *   `prepareRequestTelemetryContext`); a no-op wrapper when there's nothing
 *   to carry
 * @returns A callback with the same signature
 */
export function withRequestTelemetryContext<
  Callback extends (...args: any[]) => any
>(callback: Callback, telemetry: RequestTelemetryContext | undefined): Callback {
  // A caller registering many tools for the same request (`registerCollectionTools`)
  // calls `prepareRequestTelemetryContext` once and passes the frozen result
  // here for every tool — recognise that and skip re-deriving `isNonEmpty` +
  // re-freezing per tool. `Object.isFrozen` is `true` for `undefined` too, so
  // the no-op case still routes through here correctly. A direct caller
  // passing a raw, unprepared object (every test in this file) still gets a
  // fully self-contained, correct result — just computed here instead.
  const carried: Readonly<RequestTelemetryContext> | undefined = Object.isFrozen(telemetry)
    ? (telemetry as Readonly<RequestTelemetryContext> | undefined)
    : prepareRequestTelemetryContext(telemetry);
  if (!carried) {
    return callback;
  }

  return function attachTelemetryContext(this: unknown, ...params: any[]) {
    const extraIndex = toolCallExtraIndex(params);
    const extra = params[extraIndex];
    if (typeof extra === "object" && extra !== null) {
      params[extraIndex] = { ...extra, [TELEMETRY_CONTEXT_KEY]: carried };
    }
    return callback.apply(this, params);
  } as Callback;
}
