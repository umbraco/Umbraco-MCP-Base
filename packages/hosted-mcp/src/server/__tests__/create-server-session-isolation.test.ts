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
  confirmAction,
  type ToolCollectionExport,
  type ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../types/auth.js";

// ============================================================================
// One fetch client per session, keyed by the session's KV token key
// ============================================================================

type SessionName = "A" | "B" | "C";

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
  "token-key-C": createSessionFetchClient("C"),
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

/** The session whose server each elicitation went to, in order. */
const elicitedBy: string[] = [];

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
    tool("server-ref", async () => (getServerRef() as unknown as { __session: string }).__session),
    tool("confirm", async () => confirmAction(undefined, "Proceed?")),
    tool("confirm-slow", async () => {
      await gate;
      return confirmAction(undefined, "Proceed?");
    }),
    tool("api-client", async () => {
      const client = getApiClient<{ who: () => Promise<unknown> }>();
      return client.who();
    }),
    tool("api-client-slow", async () => {
      await gate;
      return getApiClient<{ who: () => Promise<unknown> }>().who();
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
  let serverC: McpServer;
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
      // Record which session's server an elicitation went to.
      Object.assign(server.server, {
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
        elicitInput: async () => {
          elicitedBy.push(name);
          return { action: "accept", content: { confirm: true } };
        },
      });

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
      // With its own clientFactory whose client goes through UmbracoManagementClient
      // (an Orval client), so it must still use the session's transport.
      await registerChainedTools({
        server,
        env,
        props,
        fetchUser: false,
        chainedServer: {
          ...chainedBase,
          name: "orval",
          clientFactory: () => ({ who: () => UmbracoManagementClient({ url: "/who", method: "GET" }) }),
        },
      });
    }

    // Session C has no clientFactory at all.
    const { clientFactory: _unused, ...optionsWithoutFactory } = options;
    serverC = await createPerRequestServer(optionsWithoutFactory, env, propsFor("C"));
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

  it("leaves the module-level server ref unset after sessions start", () => {
    expect(() => getServerRef()).toThrow("Server reference not set");
  });

  it("a chained clientFactory client that calls UmbracoManagementClient uses each session's own transport", async () => {
    expect(await interleave(serverA, "orval--api-client-slow", serverB, "orval--api-client")).toEqual([
      { via: "A" },
      { via: "B" },
    ]);
  });

  it("a session created without a clientFactory never gets another session's client", async () => {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    const pendingC = call(serverC, "api-client-slow");
    // Session A (with a clientFactory) runs to completion in between.
    expect(await call(serverA, "transport")).toEqual({ via: "A" });
    release();
    await expect(pendingC).rejects.toThrow("API client not configured");
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

  it("an elicitation inside a chained call goes to the caller's own session", async () => {
    elicitedBy.length = 0;
    // A parks before eliciting; B elicits in between; then A resumes.
    expect(await interleave(serverA, "inherit--confirm-slow", serverB, "inherit--confirm")).toEqual([true, true]);
    expect(elicitedBy).toEqual(["B", "A"]);
  });

  it("a hosted path outside the session store fails loudly", async () => {
    // Registered directly on the server, not through the wrapped registration.
    serverA.registerTool("direct", { description: "direct" }, async () => ({
      content: [{ type: "text" as const, text: JSON.stringify({ via: (getServerRef() as any).__session }) }],
    }));
    await expect(call(serverA, "direct")).rejects.toThrow("Server reference not set");
    expect(() => getApiClient()).toThrow("API client not configured");
    // The transport must not leak in from another session either.
    await expect(UmbracoManagementClient({ url: "/who", method: "GET" })).rejects.toThrow();
  });

  it("runInSessionContext enters the session's store for code registered directly on the server", async () => {
    const { runInSessionContext } = await import("../create-server.js");
    serverB.registerTool("direct-wrapped", { description: "direct" }, async () =>
      runInSessionContext(serverB, async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              server: (getServerRef() as any).__session,
              transport: await UmbracoManagementClient({ url: "/who", method: "GET" }),
              client: await getApiClient<{ who: () => Promise<unknown> }>().who(),
              auth: await getSessionUmbracoAuth(),
            }),
          },
        ],
      }))
    );
    expect(await call(serverB, "direct-wrapped")).toEqual({
      server: "B",
      transport: { via: "B" },
      client: { via: "B" },
      auth: { baseUrl: "https://b.example.com", accessToken: "token-B" },
    });
  });

  it("runInSessionContext throws for a server createPerRequestServer did not build", async () => {
    const { runInSessionContext } = await import("../create-server.js");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    expect(() => runInSessionContext(new McpServer({ name: "x", version: "1" }), () => 1)).toThrow(
      "no session context"
    );
  });

  it("a session without a clientFactory explains what is missing", async () => {
    await expect(call(serverC, "api-client-slow")).rejects.toThrow("without a `clientFactory`");
  });

  it("getSessionUmbracoAuth throws outside a request", async () => {
    await expect(getSessionUmbracoAuth()).rejects.toThrow("Session Umbraco auth not configured");
  });
});
