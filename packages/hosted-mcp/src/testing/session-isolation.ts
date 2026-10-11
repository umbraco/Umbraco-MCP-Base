/**
 * Session isolation check for hosted MCP servers.
 *
 * A Cloudflare isolate can host several Durable Objects of the same class, and
 * they share module scope. Each MCP session is its own Durable Object, so any
 * per-session value an MCP keeps in a module-level variable (a token, a client,
 * a token key, a server reference) can be read by another session's tool call.
 * The SDK carries its own per-session state in the per-request store
 * (umbraco/Umbraco-MCP-Base#383), but it can't see state a downstream MCP keeps
 * itself. This check exercises an MCP's real tools the way an isolate would:
 *
 * 1. Starts two sessions through the real `createPerRequestServer`, each with
 *    its own site and token in KV, and runs the MCP's own `init` hook for each
 *    (the work its Durable Object's `init()` does).
 * 2. Calls each tool from each session, after the other session has started.
 * 3. Counts the I/O points of each tool call (Umbraco requests and reads from the
 *    check's own KV), then repeats the call once per point: it pauses the call
 *    at that point, starts a third session, and runs that session's call of the
 *    same tool to completion before resuming the first. Both calls are checked.
 *
 * Every outgoing request is recorded by host and bearer token, and attributed
 * to the tool call that made it. A request made during a tool call that doesn't
 * carry that session's site and token is a violation, as is an elicitation or
 * logging message delivered to a different session's client. Nothing leaves the
 * process: `globalThis.fetch` is replaced for the duration of the check and
 * restored afterwards. Telemetry isolation isn't covered.
 *
 * @example
 * ```ts
 * import { assertSessionIsolation } from "@umbraco-cms/mcp-hosted/testing";
 *
 * it("keeps sessions isolated", async () => {
 *   await assertSessionIsolation(serverOptions, {
 *     toolCalls: [{ name: "get-page", arguments: { id: "…" } }],
 *     init: ({ server }) => registerInProcessChainedServer(server),
 *   });
 * });
 * ```
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isRequestContextRequired, resetRequireRequestContext } from "@umbraco-cms/mcp-server-sdk";
import { createPerRequestServer, type CreateServerOptions } from "../server/create-server.js";
import { getBackofficeEndpoints, storeUmbracoToken } from "../auth/token-storage.js";
import type { HostedMcpEnv } from "../types/env.js";
import type { AuthProps } from "../types/auth.js";

/** One tool call to run from every session. */
export interface IsolationToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

/** A session started by the check, as the MCP's `init` hook sees it. */
export interface IsolationSession {
  /** `A`, `B`, then `C1`, `C2`, … for the sessions started mid-call. */
  label: string;
  server: McpServer;
  env: HostedMcpEnv;
  props: AuthProps;
}

export interface SessionIsolationOptions {
  /** The tools to exercise, with arguments that make them call Umbraco. */
  toolCalls: IsolationToolCall[];
  /**
   * What the MCP's Durable Object does in `init()` after `createPerRequestServer`,
   * e.g. registering an in-process chained server or setting its own auth
   * context. This is where downstream module-level
   * state usually gets written, so include all of it.
   */
  init?: (session: IsolationSession) => void | Promise<void>;
  /** Extra env bindings and vars. `OAUTH_KV` is always the check's own store. */
  env?: Partial<HostedMcpEnv>;
  /**
   * Fake Umbraco responses. Return `undefined` to use the default: a current
   * user with every section and permission, the server version, and
   * `{ items: [], total: 0 }` for anything else.
   */
  respond?: (request: RecordedRequest) => Response | undefined | Promise<Response | undefined>;
  /** Version the fake Umbraco reports from `/server/information`. Defaults to `17.6.0`. */
  umbracoVersion?: string;
  /**
   * Decides whether a request is an Umbraco request, and so is checked. The
   * default counts a request to a session's site, or one carrying a session's
   * token. Requests that aren't (a media-from-URL source fetch, say) are
   * ignored; override this when your tools reach Umbraco some other way.
   */
  isUmbracoRequest?: (request: RecordedRequest) => boolean;
  /**
   * Stores near-expiry tokens with a refresh token, and makes the fake Umbraco
   * answer each tool call's first authenticated request with a 401 so the
   * refresh paths run. The fake token endpoint rotates tokens; the new ones are
   * attributed to their session. For these requests `RecordedRequest.token` is
   * the refresh token.
   */
  exerciseRefresh?: boolean;
  /** Per-session `props` and `env` overrides, e.g. `consentChoices.siteId` or site routing. */
  sessionOverrides?: (label: string) => { props?: Partial<AuthProps>; env?: Partial<HostedMcpEnv> };
  /**
   * Most I/O points to pause a call at, per tool. Each point costs a full call
   * from the first session plus one from a new session, so a tool with `n`
   * points costs about `n²` requests. Tools over the cap are listed in
   * `toolsOverPausePointCap`. Defaults to 20.
   */
  maxPausePoints?: number;
}

/** An outgoing request, as the fake Umbraco saw it. */
export interface RecordedRequest {
  method: string;
  url: string;
  host: string;
  /** The bearer token, or `undefined` when the request had none. */
  token: string | undefined;
}

export interface IsolationViolation {
  tool: string;
  /** The session that made the tool call. */
  session: string;
  phase: "after-other-session-started" | "session-started-mid-call";
  /** `request` for an outgoing HTTP request, `message` for an elicitation or logging message. */
  kind: "request" | "message";
  /** For a `message`, the MCP method and an empty path. */
  request: { method: string; path: string };
  /** For `session-started-mid-call`, the I/O point (1-based) the call was paused at. */
  pausePoint?: number;
  /** The session whose site the request went to (or whose client got the message), or `"unknown"`. */
  sentToSession: string;
  /** The session whose token the request carried, or `"none"` / `"unknown"`; `"n/a"` for a message. */
  tokenOfSession: string;
}

export interface SessionIsolationReport {
  ok: boolean;
  violations: IsolationViolation[];
  /** Requests made during tool calls that were checked. */
  checkedRequests: number;
  /**
   * Tools that made no Umbraco request from any session, so the check proved
   * nothing about them. Give them arguments that make them call Umbraco.
   */
  toolsWithoutRequests: string[];
  /**
   * Tools whose mid-call phase never paused a call and started a third session,
   * so concurrent calls weren't checked for them.
   */
  toolsWithoutMidCallCheck: string[];
  /** Tools with more I/O points than `maxPausePoints`: only the first `maxPausePoints` were paused at. */
  toolsOverPausePointCap: string[];
  /**
   * Pause points that never fired because the repeated call made fewer I/O
   * points than the baseline (cached tokens skip KV reads; a refresh happens
   * only on the first call), so nothing was checked at them.
   */
  unreachedPausePoints: { tool: string; point: number }[];
}

const HOST_SUFFIX = ".isolation-check.invalid";
const hostFor = (label: string) => `session-${label.toLowerCase()}${HOST_SUFFIX}`;
const tokenFor = (label: string) => `isolation-token-${label.toLowerCase()}`;
const refreshTokenFor = (label: string, generation: number) => `isolation-refresh-${label.toLowerCase()}-${generation}`;
const isSessionHost = (host: string) => host.startsWith("session-") && host.endsWith(HOST_SUFFIX);
const labelOfHost = (host: string) =>
  isSessionHost(host) ? host.slice("session-".length, -HOST_SUFFIX.length).toUpperCase() : "unknown";
const TOKEN_ENDPOINT_PATH = new URL(getBackofficeEndpoints("https://x.invalid").token_endpoint).pathname;

/** One tool call in flight. Requests are attributed to it through async context. */
interface CallBucket {
  label: string;
  requests: RecordedRequest[];
  messages: { type: string; receivedBy: string }[];
  /** I/O points seen so far in this call (Umbraco requests and check-KV reads). */
  ioPoints: number;
  /** Pause the call at this I/O point (1-based) by running `onPause`. */
  pauseAt?: number;
  onPause?: () => Promise<void>;
  hookError?: unknown;
  unauthorizedSent?: boolean;
}

// Two runs would swap each other's `globalThis.fetch`.
let running = false;

function createMemoryKv(onRead: () => Promise<void>): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: unknown) => {
      await onRead();
      const value = store.get(key) ?? null;
      return value !== null && type === "json" ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cacheStatus: null }),
  } as unknown as KVNamespace;
}

function headerValue(init: RequestInit | undefined, request: Request | undefined, name: string): string | undefined {
  const fromInit = init?.headers ? new Headers(init.headers).get(name) : null;
  return fromInit ?? request?.headers.get(name) ?? undefined;
}

function defaultResponse(request: RecordedRequest, umbracoVersion: string, userLabel: string): Response {
  const path = new URL(request.url).pathname;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (path.endsWith("/user/current")) {
    return json({
      id: `${userLabel}-user`,
      name: "Isolation check user",
      allowedSections: ["Umb.Section.Content", "Umb.Section.Media", "Umb.Section.Settings", "Umb.Section.Members"],
      fallbackPermissions: [],
      hasAccessToAllLanguages: true,
      hasAccessToSensitiveData: true,
    });
  }
  if (path.endsWith("/server/information")) return json({ version: umbracoVersion });
  return json({ items: [], total: 0 });
}

/**
 * Runs the check and returns a report. Use {@link assertSessionIsolation} to
 * fail a test with a readable message instead.
 */
export async function checkSessionIsolation(
  serverOptions: CreateServerOptions,
  options: SessionIsolationOptions,
): Promise<SessionIsolationReport> {
  if (running) {
    throw new Error("checkSessionIsolation is already running: concurrent runs would swap each other's globalThis.fetch stub.");
  }
  running = true;
  // The hosted server turns this process-wide flag on; restore it unless the caller had set it.
  const wasRequired = isRequestContextRequired();
  try {
    return await runCheck(serverOptions, options);
  } finally {
    if (!wasRequired) resetRequireRequestContext();
    running = false;
  }
}

async function runCheck(serverOptions: CreateServerOptions, options: SessionIsolationOptions): Promise<SessionIsolationReport> {
  const umbracoVersion = options.umbracoVersion ?? "17.6.0";
  const callContext = new AsyncLocalStorage<CallBucket | null>();

  /**
   * Counts an I/O point of the current call and, when it's the one the call is
   * to be paused at, runs the pause hook to completion before the call resumes.
   */
  async function ioPoint(): Promise<void> {
    const bucket = callContext.getStore();
    if (!bucket) return;
    bucket.ioPoints++;
    const pause = bucket.onPause;
    if (pause && bucket.ioPoints === bucket.pauseAt) {
      bucket.onPause = undefined;
      // Kept rather than thrown here: the tool's own error handling would hide it.
      await pause().catch((error) => {
        bucket.hookError ??= error;
      });
    }
  }

  const kv = createMemoryKv(ioPoint);
  // Tracing needs the Workers runtime; the check runs in a test process.
  const { telemetry: _telemetry, ...createOptions } = serverOptions;

  // Which session each token (access, refresh, rotated) was issued to.
  const tokenOwners = new Map<string, string>();
  const generations = new Map<string, number>();
  const labelOfToken = (token: string | undefined) => (token === undefined ? "none" : (tokenOwners.get(token) ?? "unknown"));
  const isUmbracoRequest =
    options.isUmbracoRequest ?? ((request: RecordedRequest) => isSessionHost(request.host) || tokenOwners.has(request.token ?? ""));

  function tokenEndpointResponse(body: string): Response {
    const owner = tokenOwners.get(new URLSearchParams(body).get("refresh_token") ?? "");
    if (!owner) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
    const generation = (generations.get(owner) ?? 0) + 1;
    generations.set(owner, generation);
    const accessToken = `${tokenFor(owner)}-r${generation}`;
    const refreshToken = refreshTokenFor(owner, generation);
    tokenOwners.set(accessToken, owner);
    tokenOwners.set(refreshToken, owner);
    return new Response(
      JSON.stringify({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = request ? request.url : String(input);
    const parsed = new URL(url);
    const isTokenEndpoint = parsed.pathname === TOKEN_ENDPOINT_PATH;
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "";
    const authorization = headerValue(init, request, "authorization");
    const recorded: RecordedRequest = {
      method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
      url,
      host: parsed.hostname,
      token: isTokenEndpoint ? (new URLSearchParams(body).get("refresh_token") ?? undefined) : authorization?.replace(/^Bearer\s+/i, ""),
    };
    const bucket = callContext.getStore();
    if (bucket) {
      bucket.requests.push(recorded);
      // Only Umbraco requests are I/O points: a non-Umbraco fetch is ignored.
      if (isUmbracoRequest(recorded)) await ioPoint();
    }
    const custom = await options.respond?.(recorded);
    if (custom) return custom;
    if (isTokenEndpoint) return tokenEndpointResponse(body);
    if (options.exerciseRefresh && bucket && !bucket.unauthorizedSent && recorded.token) {
      bucket.unauthorizedSent = true;
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    }
    return defaultResponse(recorded, umbracoVersion, labelOfToken(recorded.token));
  }) as typeof fetch;

  const clients = new Map<string, Client>();
  async function startSession(label: string): Promise<void> {
    const tokenKey = `isolation-check-${label.toLowerCase()}`;
    const baseUrl = `https://${hostFor(label)}`;
    const overrides = options.sessionOverrides?.(label);
    const sessionEnv = { ...options.env, ...overrides?.env, OAUTH_KV: kv } as HostedMcpEnv;
    const accessToken = tokenFor(label);
    tokenOwners.set(accessToken, label);
    const tokens: Record<string, unknown> = { access_token: accessToken, token_type: "Bearer", expires_in: options.exerciseRefresh ? 1 : 3600 };
    if (options.exerciseRefresh) {
      tokens.refresh_token = refreshTokenFor(label, 0);
      tokenOwners.set(refreshTokenFor(label, 0), label);
    }
    await storeUmbracoToken(kv, tokenKey, tokens as never, { oauthClientId: "isolation-check", baseUrl, serverUrl: baseUrl });
    const props: AuthProps = { umbracoTokenKey: tokenKey, userId: `isolation-${label}`, userName: `Session ${label}`, ...overrides?.props };
    const server = await createPerRequestServer(createOptions, sessionEnv, props);
    await options.init?.({ label, server, env: sessionEnv, props });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "session-isolation-check", version: "1.0.0" }, { capabilities: { elicitation: {} } });
    // A message sent during a tool call that lands on another session's client is a leak.
    const received = (type: string) => callContext.getStore()?.messages.push({ type, receivedBy: label });
    client.setRequestHandler(ElicitRequestSchema, async () => {
      received("elicitation/create");
      return { action: "decline" as const };
    });
    client.setNotificationHandler(LoggingMessageNotificationSchema, async () => {
      received("notifications/message");
    });
    await client.connect(clientTransport);
    clients.set(label, client);
  }

  const violations: IsolationViolation[] = [];
  const requestsByTool = new Map<string, number>();
  let checkedRequests = 0;
  const midCallPauses = new Map<string, number>();
  let midCallSessions = 0;
  const maxPausePoints = options.maxPausePoints ?? 20;
  const toolsOverPausePointCap: string[] = [];
  const unreachedPausePoints: { tool: string; point: number }[] = [];

  async function callFrom(
    label: string,
    toolCall: IsolationToolCall,
    phase: IsolationViolation["phase"],
    pauseAt?: number,
  ): Promise<number> {
    const bucket: CallBucket = { label, requests: [], messages: [], ioPoints: 0 };
    if (pauseAt !== undefined) {
      // A is paused at its `pauseAt`-th I/O point while C starts and runs the same tool to completion.
      bucket.pauseAt = pauseAt;
      bucket.onPause = async () => {
        midCallPauses.set(toolCall.name, (midCallPauses.get(toolCall.name) ?? 0) + 1);
        const other = `C${++midCallSessions}`;
        await callContext.run(null, () => startSession(other));
        await callFrom(other, toolCall, phase);
      };
    }
    try {
      // Tool errors are expected with fake responses; only the requests matter.
      await callContext
        .run(bucket, () => clients.get(label)!.callTool({ name: toolCall.name, arguments: toolCall.arguments ?? {} }))
        .catch(() => undefined);
    } finally {
      if (pauseAt !== undefined && bucket.onPause) unreachedPausePoints.push({ tool: toolCall.name, point: pauseAt });
      const umbracoRequests = bucket.requests.filter(isUmbracoRequest);
      requestsByTool.set(toolCall.name, (requestsByTool.get(toolCall.name) ?? 0) + umbracoRequests.length);
      for (const request of umbracoRequests) {
        checkedRequests++;
        // Our own site without a token isn't a leak.
        if (request.host === hostFor(label) && (request.token === undefined || labelOfToken(request.token) === label)) continue;
        violations.push({
          tool: toolCall.name,
          session: label,
          phase,
          pausePoint: pauseAt,
          kind: "request",
          request: { method: request.method, path: new URL(request.url).pathname },
          sentToSession: labelOfHost(request.host),
          tokenOfSession: labelOfToken(request.token),
        });
      }
      for (const message of bucket.messages) {
        if (message.receivedBy === label) continue;
        violations.push({
          tool: toolCall.name,
          session: label,
          phase,
          kind: "message",
          pausePoint: pauseAt,
          request: { method: message.type, path: "" },
          sentToSession: message.receivedBy,
          tokenOfSession: "n/a",
        });
      }
    }
    if (bucket.hookError) throw bucket.hookError;
    return bucket.ioPoints;
  }

  try {
    await startSession("A");
    await startSession("B");
    for (const toolCall of options.toolCalls) {
      // B started last, so a module-level value now holds B's state.
      const ioPoints = await callFrom("A", toolCall, "after-other-session-started");
      await callFrom("B", toolCall, "after-other-session-started");
      // A third session starts and calls the tool while A's call is paused at each I/O point in turn.
      if (ioPoints > maxPausePoints) toolsOverPausePointCap.push(toolCall.name);
      for (let point = 1; point <= Math.min(ioPoints, maxPausePoints); point++) {
        await callFrom("A", toolCall, "session-started-mid-call", point);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([...clients.values()].map((client) => client.close().catch(() => undefined)));
  }

  return {
    ok: violations.length === 0,
    violations,
    checkedRequests,
    toolsWithoutRequests: options.toolCalls.map((t) => t.name).filter((name) => !requestsByTool.get(name)),
    toolsWithoutMidCallCheck: options.toolCalls.map((t) => t.name).filter((name) => !midCallPauses.get(name)),
    toolsOverPausePointCap,
    unreachedPausePoints,
  };
}

/**
 * Runs {@link checkSessionIsolation} and throws if any tool call used another
 * session's site or token, or if a listed tool made no Umbraco request at all.
 */
export async function assertSessionIsolation(
  serverOptions: CreateServerOptions,
  options: SessionIsolationOptions,
): Promise<SessionIsolationReport> {
  const report = await checkSessionIsolation(serverOptions, options);
  const at = (v: IsolationViolation) => (v.pausePoint === undefined ? "" : ` at I/O point ${v.pausePoint}`);
  const problems: string[] = report.violations.map((v) =>
    v.kind === "message"
      ? `- ${v.tool} called from session ${v.session} (${v.phase}${at(v)}): ${v.request.method} was delivered to session ${v.sentToSession}'s client`
      : `- ${v.tool} called from session ${v.session} (${v.phase}${at(v)}): ${v.request.method} ${v.request.path} ` +
        `went to session ${v.sentToSession}'s site with session ${v.tokenOfSession}'s token`,
  );
  if (report.toolsWithoutRequests.length > 0) {
    problems.push(
      `- made no Umbraco request, so isolation wasn't checked: ${report.toolsWithoutRequests.join(", ")} ` +
        `(pass arguments that make them call Umbraco)`,
    );
  }
  const unpaused = report.toolsWithoutMidCallCheck.filter((name) => !report.toolsWithoutRequests.includes(name));
  if (unpaused.length > 0) {
    problems.push(`- no session was started mid-call, so concurrent calls weren't checked: ${unpaused.join(", ")}`);
  }
  if (report.toolsOverPausePointCap.length > 0) {
    problems.push(
      `- more I/O points than maxPausePoints, so later points weren't checked: ${report.toolsOverPausePointCap.join(", ")} ` +
        `(raise maxPausePoints)`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `Session isolation check failed. Per-session state is shared between sessions in one isolate:\n${problems.join("\n")}`,
    );
  }
  return report;
}
