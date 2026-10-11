/**
 * Async Request Context Store
 *
 * An `AsyncLocalStorage` holding the request-scoped values of a tool call:
 *
 * - the two values the SDK also carries on a tool call's `extra` — the
 *   telemetry carrier (`telemetry/request-context.ts`) and the connected
 *   Umbraco version (`umbraco-version/request-context.ts`);
 * - the hosted session's own values (see {@link RequestSessionContext}) — its
 *   Umbraco transport, API client provider, MCP `Server` and Umbraco auth.
 *   These never go on a chained call's `extra`; they only live in the store.
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
 * The session values exist for a second reason. A Cloudflare isolate can host
 * several Durable Objects of the same class, sharing module scope, and each
 * MCP session is its own Durable Object. A module-level "current transport"
 * or "current server" is therefore last-session-wins across every session in
 * the isolate. `UmbracoManagementClient`, `getApiClient()`, `getServerRef()`
 * and `getSessionUmbracoAuth()` read the store first and only fall back to
 * their module value when no store is active (stdio, CLI, tests).
 *
 * **Rule for hosted code:** never keep per-session values (tokens, clients,
 * servers, token keys) in module scope. Put them in this store at the
 * tool-call boundary and read them through its accessors.
 *
 * The SDK itself only *reads* the store; entering it is the host's job
 * (`InProcessConnection.callTool` re-enters it only to override
 * `apiClientProvider` for a chained server with its own `clientFactory`).
 *
 * Kept in its own file so `node:async_hooks` is only pulled in by the code
 * that actually uses it. Workers need `nodejs_compat` (or `nodejs_compat_v2`)
 * for this import.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
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

/**
 * Orval-mutator-shaped transport (`(config, options) => Promise<T>`). Same
 * shape as `CustomTransport` in `http/umbraco-fetch-client.ts`, restated
 * structurally here so this file doesn't import the HTTP module.
 */
export type RequestTransport = <T>(
  config: {
    url: string;
    method: string;
    data?: unknown;
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
  options?: Record<string, unknown>
) => Promise<T>;

/** The active session's resolved Umbraco credentials, for raw `fetch` callers. */
export interface SessionUmbracoAuth {
  /** Base URL the session's requests go to (no trailing slash). */
  baseUrl: string;
  /** A Bearer token valid at the moment it is handed over. */
  accessToken: string;
}

/**
 * Per-session values a hosted host puts in the store at the tool-call
 * boundary. Never copied onto a chained call's `extra`.
 */
export interface RequestSessionContext {
  /** The session's transport behind `UmbracoManagementClient`. */
  transport?: RequestTransport;
  /** The session's API client provider, read by `getApiClient()`. */
  apiClientProvider?: () => unknown;
  /** The session's MCP `Server` (`McpServer.server`), read by `getServerRef()`. */
  server?: Server;
  /**
   * Resolves the session's Umbraco auth, refreshing first when the token is
   * expired or near expiry. Read by `getSessionUmbracoAuth()`.
   */
  umbracoAuth?: () => Promise<SessionUmbracoAuth>;
}

/** Everything the store holds: the carried values plus the session's own. */
export interface RequestContextStore extends CarriedRequestContext, RequestSessionContext {}

const store = new AsyncLocalStorage<Readonly<RequestContextStore>>();

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
 * Picks only the session values (see {@link RequestSessionContext}) off
 * `values`, each only when it has the expected shape.
 */
function pickSessionContext(values: unknown): RequestSessionContext {
  const picked: RequestSessionContext = {};
  if (typeof values !== "object" || values === null) {
    return picked;
  }
  const source = values as RequestSessionContext;
  if (typeof source.transport === "function") {
    picked.transport = source.transport;
  }
  if (typeof source.apiClientProvider === "function") {
    picked.apiClientProvider = source.apiClientProvider;
  }
  if (typeof source.server === "object" && source.server !== null) {
    picked.server = source.server;
  }
  if (typeof source.umbracoAuth === "function") {
    picked.umbracoAuth = source.umbracoAuth;
  }
  return picked;
}

/**
 * Runs `fn` with `values` as the active request context. Hosts call this at
 * the tool-call boundary; everything `fn` awaits sees the same values, and
 * concurrent calls each see their own.
 *
 * Only the two carried keys and the session keys of
 * {@link RequestSessionContext} are stored, whatever else `values` holds, so
 * a host may pass the tool call's `extra` spread together with the session's
 * values.
 *
 * @param values - The request's values (or a full tool-call `extra`)
 * @param fn - The work to run inside the context
 * @returns Whatever `fn` returns
 */
export function runWithRequestContext<T>(values: unknown, fn: () => T): T {
  return store.run(
    Object.freeze({ ...pickCarriedRequestContext(values), ...pickSessionContext(values) }),
    fn
  );
}

/**
 * The active request context entered by {@link runWithRequestContext}, or
 * `undefined` outside one.
 */
export function getActiveRequestContext(): Readonly<RequestContextStore> | undefined {
  return store.getStore();
}

/**
 * The active session's Umbraco auth — `{ baseUrl, accessToken }` — for code
 * that has to call Umbraco outside `UmbracoManagementClient` (e.g. a raw
 * streaming `fetch` with `duplex: "half"`).
 *
 * The host's resolver refreshes the token first when it is expired or near
 * expiry, so the token is valid when it is handed over. There is no
 * retry-on-401 for the caller: a streamed body can't be replayed.
 *
 * Use this instead of keeping your own module-level copy of a session's env
 * or token key — module scope is shared by every session in a Worker isolate.
 *
 * @throws Error when called outside a request whose host put Umbraco auth in
 *   the store (stdio, CLI, or outside a tool call)
 */
export async function getSessionUmbracoAuth(): Promise<SessionUmbracoAuth> {
  const resolve = store.getStore()?.umbracoAuth;
  if (!resolve) {
    throw new Error(
      "Session Umbraco auth not configured. getSessionUmbracoAuth() only works inside a hosted tool call, where the host puts the session's Umbraco auth in the request context."
    );
  }
  return resolve();
}
