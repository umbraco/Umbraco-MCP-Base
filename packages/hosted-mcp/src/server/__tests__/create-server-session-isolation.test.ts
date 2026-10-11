/**
 * Per-session state isolation — umbraco/Umbraco-MCP-Base#383.
 *
 * A Cloudflare isolate can host several Durable Objects of the same class,
 * sharing module scope, and each MCP session is its own Durable Object. When
 * `createPerRequestServer` wrote the session's fetch client into the SDK's
 * module-level `setCustomTransport` / `configureApiClient`, the last session to
 * start won for every session in the isolate.
 *
 * Two sessions are created here in one process, with different transports,
 * and their tool calls are interleaved across an `await`. The calls go through
 * public API only (`createPerRequestServer`, `registerChainedTools`,
 * `UmbracoManagementClient`, `getApiClient`, `getServerRef`), so the
 * regression half of this file fails on a build that still writes the globals.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  UmbracoManagementClient,
  getApiClient,
  getServerRef,
  getSessionUmbracoAuth,
  type ToolCollectionExport,
  type ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../types/auth.js";

// ============================================================================
// One fetch client per session, keyed by the session's KV token key
// ============================================================================

type SessionName = "A" | "B";

function createSessionFetchClient(name: SessionName) {
  const client = jest.fn(async (config: { url: string }) => {
    if (config.url === "/umbraco/management/api/v1/user/current") {
      return { allowedSections: ["content"] };
    }
    return { via: name };
  });
  return Object.assign(client, {
    getRefreshFailure: () => undefined,
    getSessionAuth: async () => ({
      baseUrl: `https://${name.toLowerCase()}.example.com`,
      accessToken: `token-${name}`,
    }),
  });
}

const sessionClients: Record<string, ReturnType<typeof createSessionFetchClient>> = {
  "token-key-A": createSessionFetchClient("A"),
  "token-key-B": createSessionFetchClient("B"),
};

jest.unstable_mockModule("../../http/umbraco-fetch-client.js", () => ({
  createFetchClientFromKV: jest.fn(async (_env: unknown, tokenKey: string) => sessionClients[tokenKey] ?? null),
  createUmbracoFetchClient: jest.fn(),
  CAPTURE_RAW_HTTP_RESPONSE: { returnFullResponse: true },
}));

// ============================================================================
// Fixtures
// ============================================================================

const env = {
  UMBRACO_BASE_URL: "https://example.com",
  UMBRACO_OAUTH_CLIENT_ID: "test-client",
  COOKIE_ENCRYPTION_KEY: "0".repeat(64),
  OAUTH_KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
} as unknown as HostedMcpEnv;

const propsFor = (name: SessionName): AuthProps => ({
  userId: `user-${name}`,
  userName: `User ${name}`,
  umbracoTokenKey: `token-key-${name}`,
});

/**
 * A gate the "slow" tool awaits before it calls Umbraco, so the test can let
 * the other session's call run in between.
 */
let gate: Promise<void> = Promise.resolve();

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

const tool = (name: string, handler: () => Promise<unknown>): ToolDefinition<any, any> => ({
  name,
  description: name,
  slices: ["read"],
  handler: async () => text(await handler()),
});

const mainCollection: ToolCollectionExport = {
  metadata: { name: "main", displayName: "Main", description: "" },
  tools: () => [
    // The Orval client's path: UmbracoManagementClient reads the transport at call time.
    tool("transport-slow", async () => {
      await gate;
      return UmbracoManagementClient({ url: "/who", method: "GET" });
    }),
    tool("transport", async () => UmbracoManagementClient({ url: "/who", method: "GET" })),
    // The executeGetApiCall path: getApiClient() returns the clientFactory's client.
    tool("api-client-slow", async () => {
      await gate;
      return getApiClient<{ who: () => Promise<unknown> }>().who();
    }),
    tool("server-ref", async () => (getServerRef() as unknown as { __session: string }).__session),
    tool("session-auth-slow", async () => {
      await gate;
      return getSessionUmbracoAuth();
    }),
  ],
};

const chainedCollection: ToolCollectionExport = {
  metadata: { name: "chained-col", displayName: "Chained", description: "" },
  tools: () => [
    tool("transport-slow", async () => {
      await gate;
      return UmbracoManagementClient({ url: "/who", method: "GET" });
    }),
    tool("transport", async () => UmbracoManagementClient({ url: "/who", method: "GET" })),
    tool("api-client", async () => {
      const client = getApiClient<{ who: () => Promise<unknown> }>();
      return client.who();
    }),
  ],
};

const options = {
  name: "isolation-test",
  version: "1.0.0",
  collections: [mainCollection],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: ["read"],
  // Same factory for every session, as in a real worker: it is stateless and
  // routes through UmbracoManagementClient, which picks the session's transport.
  clientFactory: () => ({ who: () => UmbracoManagementClient({ url: "/who", method: "GET" }) }),
};

const chainedBase = {
  displayName: "Chained",
  collections: [chainedCollection],
  modeRegistry: [{ name: "all", displayName: "All", description: "", collections: ["chained-col"] }],
  allModeNames: ["all"],
  allSliceNames: ["read"],
};

const extra = () => ({
  signal: new AbortController().signal,
  requestId: "test",
  sendNotification: async () => {},
  sendRequest: async () => ({}),
});

/** Invokes a registered tool's handler as the MCP SDK would, and parses the text result. */
async function call(server: McpServer, toolName: string): Promise<unknown> {
  const registered = (server as unknown as {
    _registeredTools: Record<string, { handler: (...args: unknown[]) => Promise<{ content: { text: string }[] }> }>;
  })._registeredTools[toolName];
  if (!registered) throw new Error(`tool not registered: ${toolName}`);
  const result = await registered.handler({}, extra());
  return JSON.parse(result.content[0].text);
}

/**
 * Starts `slowTool` on session A (it parks on the gate), runs `fastTool` on
 * session B to completion, then releases A. A's call therefore resumes after
 * B has both started and called Umbraco.
 */
async function interleave(
  a: McpServer,
  slowTool: string,
  b: McpServer,
  fastTool: string
): Promise<[unknown, unknown]> {
  let release!: () => void;
  gate = new Promise<void>((resolve) => (release = resolve));
  const pendingA = call(a, slowTool);
  const resultB = await call(b, fastTool);
  release();
  return [await pendingA, resultB];
}

// ============================================================================
// Tests
// ============================================================================

describe("createPerRequestServer keeps per-session state per session", () => {
  let serverA: McpServer;
  let serverB: McpServer;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const { createPerRequestServer } = await import("../create-server.js");
    const { registerChainedTools } = await import("../register-chained-tools.js");

    // Session A starts first, session B second — B is "last session wins".
    serverA = await createPerRequestServer(options, env, propsFor("A"));
    serverB = await createPerRequestServer(options, env, propsFor("B"));

    for (const [server, name] of [
      [serverA, "A"],
      [serverB, "B"],
    ] as const) {
      // Tag each session's underlying Server so getServerRef() is identifiable.
      (server.server as unknown as { __session: string }).__session = name;

      const props = propsFor(name);
      // Without its own clientFactory: inherits the caller's client.
      await registerChainedTools({ server, env, props, fetchUser: false, chainedServer: { ...chainedBase, name: "inherit" } });
      // With its own clientFactory: gets that factory's client.
      await registerChainedTools({
        server,
        env,
        props,
        fetchUser: false,
        chainedServer: {
          ...chainedBase,
          name: "own",
          clientFactory: () => ({ who: async () => ({ via: "own-client-factory" }) }),
        },
      });
    }
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  it("regression: interleaved tool calls each use their own session's transport", async () => {
    expect(await interleave(serverA, "transport-slow", serverB, "transport")).toEqual([
      { via: "A" },
      { via: "B" },
    ]);
  });

  it("regression: the clientFactory's client goes out through each session's own transport", async () => {
    expect(await interleave(serverA, "api-client-slow", serverB, "transport")).toEqual([
      { via: "A" },
      { via: "B" },
    ]);
  });

  it("regression: a chained call uses its own session's transport across an await", async () => {
    expect(await interleave(serverA, "inherit--transport-slow", serverB, "inherit--transport")).toEqual([
      { via: "A" },
      { via: "B" },
    ]);
  });

  it("leaves the module-level transport and API client unset after two sessions start", async () => {
    // Outside any tool call there is no store, so these read the module
    // fallbacks — which hosted must never write.
    expect(() => getApiClient()).toThrow("API client not configured");
    await expect(UmbracoManagementClient({ url: "/who", method: "GET" })).rejects.toThrow(
      "UmbracoFetch not initialized"
    );
  });

  it("resolves the server ref per session", async () => {
    expect(await call(serverA, "server-ref")).toBe("A");
    expect(await call(serverB, "server-ref")).toBe("B");
  });

  it("gives a chained server with a clientFactory that factory's client", async () => {
    expect(await call(serverA, "own--api-client")).toEqual({ via: "own-client-factory" });
  });

  it("gives a chained server without a clientFactory the caller's client", async () => {
    expect(await call(serverA, "inherit--api-client")).toEqual({ via: "A" });
    expect(await call(serverB, "inherit--api-client")).toEqual({ via: "B" });
  });

  it("getSessionUmbracoAuth returns each interleaved session's own auth", async () => {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    const pendingA = call(serverA, "session-auth-slow");
    const pendingB = call(serverB, "session-auth-slow");
    release();
    expect(await Promise.all([pendingA, pendingB])).toEqual([
      { baseUrl: "https://a.example.com", accessToken: "token-A" },
      { baseUrl: "https://b.example.com", accessToken: "token-B" },
    ]);
  });

  it("getSessionUmbracoAuth throws outside a request", async () => {
    await expect(getSessionUmbracoAuth()).rejects.toThrow("Session Umbraco auth not configured");
  });
});
