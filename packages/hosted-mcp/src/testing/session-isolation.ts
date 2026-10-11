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
 * 3. Calls each tool again and starts a third session in the middle of the call,
 *    while the call is waiting on its first Umbraco request.
 *
 * Every outgoing request is recorded by host and bearer token. A request made
 * during a tool call that doesn't carry that session's site and token is a
 * violation. Nothing leaves the process: `globalThis.fetch` is replaced for the
 * duration of the check and restored afterwards.
 *
 * @example
 * ```ts
 * import { assertSessionIsolation } from "@umbraco-cms/mcp-hosted/testing";
 *
 * it("keeps sessions isolated", async () => {
 *   await assertSessionIsolation(serverOptions, {
 *     toolCalls: [{ name: "get-page", arguments: { id: "…" } }],
 *     init: ({ server }) => setServerRef(server.server),
 *   });
 * });
 * ```
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPerRequestServer, type CreateServerOptions } from "../server/create-server.js";
import { storeUmbracoToken } from "../auth/token-storage.js";
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
   * e.g. `setServerRef(server.server)`, registering an in-process chained server,
   * or setting its own auth context. This is where downstream module-level
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
  request: { method: string; path: string };
  /** The session whose site the request went to, or `"unknown"`. */
  sentToSession: string;
  /** The session whose token the request carried, or `"none"` / `"unknown"`. */
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
}

const HOST_SUFFIX = ".isolation-check.invalid";
const hostFor = (label: string) => `session-${label.toLowerCase()}${HOST_SUFFIX}`;
const tokenFor = (label: string) => `isolation-token-${label.toLowerCase()}`;
const labelOfHost = (host: string) =>
  host.endsWith(HOST_SUFFIX) ? host.slice("session-".length, -HOST_SUFFIX.length).toUpperCase() : "unknown";
const labelOfToken = (token: string | undefined) =>
  token === undefined ? "none" : token.startsWith("isolation-token-") ? token.slice("isolation-token-".length).toUpperCase() : "unknown";

function createMemoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: unknown) => {
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

function defaultResponse(request: RecordedRequest, umbracoVersion: string): Response {
  const path = new URL(request.url).pathname;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (path.endsWith("/user/current")) {
    return json({
      id: `${labelOfToken(request.token)}-user`,
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
  const umbracoVersion = options.umbracoVersion ?? "17.6.0";
  const kv = createMemoryKv();
  const env = { ...options.env, OAUTH_KV: kv } as HostedMcpEnv;
  // Tracing needs the Workers runtime; the check runs in a test process.
  const { telemetry: _telemetry, ...optionsWithoutTelemetry } = serverOptions as CreateServerOptions & { telemetry?: unknown };
  const createOptions = optionsWithoutTelemetry as CreateServerOptions;

  // Requests made during a tool call are collected here; null means "not in a call".
  let current: { requests: RecordedRequest[]; onFirstRequest?: () => Promise<void> } | null = null;
  // Requests made while a session is being started belong to that session, not the call.
  let startingSession = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = request ? request.url : String(input);
    const authorization = headerValue(init, request, "authorization");
    const recorded: RecordedRequest = {
      method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
      url,
      host: new URL(url).hostname,
      token: authorization?.replace(/^Bearer\s+/i, ""),
    };
    if (current && !startingSession) {
      current.requests.push(recorded);
      const hook = current.onFirstRequest;
      if (hook) {
        current.onFirstRequest = undefined;
        await hook();
      }
    }
    return (await options.respond?.(recorded)) ?? defaultResponse(recorded, umbracoVersion);
  }) as typeof fetch;

  const clients = new Map<string, Client>();
  async function startSession(label: string): Promise<void> {
    startingSession = true;
    try {
      const tokenKey = `isolation-check-${label.toLowerCase()}`;
      const baseUrl = `https://${hostFor(label)}`;
      await storeUmbracoToken(kv, tokenKey, { access_token: tokenFor(label), token_type: "Bearer", expires_in: 3600 } as never, {
        oauthClientId: "isolation-check",
        baseUrl,
        serverUrl: baseUrl,
      });
      const props: AuthProps = { umbracoTokenKey: tokenKey, userId: `isolation-${label}`, userName: `Session ${label}` };
      const server = await createPerRequestServer(createOptions, env, props);
      await options.init?.({ label, server, env, props });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "session-isolation-check", version: "1.0.0" });
      await client.connect(clientTransport);
      clients.set(label, client);
    } finally {
      startingSession = false;
    }
  }

  const violations: IsolationViolation[] = [];
  const requestsByTool = new Map<string, number>();
  let checkedRequests = 0;
  let midCallSessions = 0;

  async function callFrom(label: string, toolCall: IsolationToolCall, phase: IsolationViolation["phase"]): Promise<void> {
    current = { requests: [] };
    if (phase === "session-started-mid-call") {
      current.onFirstRequest = () => startSession(`C${++midCallSessions}`);
    }
    try {
      // Tool errors are expected with fake responses; only the requests matter.
      await clients.get(label)!.callTool({ name: toolCall.name, arguments: toolCall.arguments ?? {} }).catch(() => undefined);
    } finally {
      const { requests } = current;
      current = null;
      requestsByTool.set(toolCall.name, (requestsByTool.get(toolCall.name) ?? 0) + requests.length);
      for (const request of requests) {
        checkedRequests++;
        if (request.host === hostFor(label) && request.token === tokenFor(label)) continue;
        violations.push({
          tool: toolCall.name,
          session: label,
          phase,
          request: { method: request.method, path: new URL(request.url).pathname },
          sentToSession: labelOfHost(request.host),
          tokenOfSession: labelOfToken(request.token),
        });
      }
    }
  }

  try {
    await startSession("A");
    await startSession("B");
    for (const toolCall of options.toolCalls) {
      // B started last, so a module-level value now holds B's state.
      await callFrom("A", toolCall, "after-other-session-started");
      await callFrom("B", toolCall, "after-other-session-started");
      // A third session starts while A's call is waiting on Umbraco.
      await callFrom("A", toolCall, "session-started-mid-call");
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
  const problems: string[] = report.violations.map(
    (v) =>
      `- ${v.tool} called from session ${v.session} (${v.phase}): ${v.request.method} ${v.request.path} ` +
      `went to session ${v.sentToSession}'s site with session ${v.tokenOfSession}'s token`,
  );
  if (report.toolsWithoutRequests.length > 0) {
    problems.push(
      `- made no Umbraco request, so isolation wasn't checked: ${report.toolsWithoutRequests.join(", ")} ` +
        `(pass arguments that make them call Umbraco)`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `Session isolation check failed. Per-session state is shared between sessions in one isolate:\n${problems.join("\n")}`,
    );
  }
  return report;
}
