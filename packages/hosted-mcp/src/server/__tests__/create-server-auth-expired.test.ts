/**
 * Degraded `authentication-expired` server — refresh-rejection path.
 *
 * The no-token-in-KV path is covered in `telemetry/__tests__/spans.test.ts`.
 * This file covers the other half added for umbraco/Umbraco-MCP-Base#320: KV
 * still holds an entry, but Umbraco has definitively rejected its refresh token,
 * so the session is over even though a fetch client could be built.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../types/auth.js";
import type { RefreshFailure } from "../../auth/token-storage.js";

// The fetch client is what reports the refresh failure, so it's the seam.
let refreshFailure: RefreshFailure | undefined;
/** The refresh token the (mocked) failed refresh posted and Umbraco rejected. */
let rejectedRefreshToken: string | undefined;

const mockFetchClient = Object.assign(
  jest.fn<any>().mockResolvedValue({ allowedSections: ["content"] }),
  {
    getRefreshFailure: () => refreshFailure,
    getRejectedRefreshToken: () => rejectedRefreshToken,
  }
);

jest.unstable_mockModule("../../http/umbraco-fetch-client.js", () => ({
  createFetchClientFromKV: jest.fn<any>().mockResolvedValue(mockFetchClient),
  createUmbracoFetchClient: jest.fn<any>(),
  CAPTURE_RAW_HTTP_RESPONSE: { returnFullResponse: true },
}));

const kvDelete = jest.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined);
/** What KV holds for this login when the server re-reads it before deleting. */
let storedRefreshToken: string | undefined;
const kvGet = jest.fn(async () =>
  storedRefreshToken === undefined
    ? null
    : JSON.stringify({ tokens: { access_token: "a", refresh_token: storedRefreshToken } })
);

const env = {
  UMBRACO_BASE_URL: "https://example.com",
  UMBRACO_OAUTH_CLIENT_ID: "test-client",
  COOKIE_ENCRYPTION_KEY: "0".repeat(64),
  OAUTH_KV: {
    get: kvGet,
    put: async () => undefined,
    delete: kvDelete,
  },
} as unknown as HostedMcpEnv;

const props: AuthProps = {
  userId: "user-1",
  userName: "Test User",
  umbracoTokenKey: "token-key",
};

const baseOptions = {
  name: "test-server",
  version: "1.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

/** Names of the tools registered on a real McpServer. */
function toolNames(server: unknown): string[] {
  return Object.keys((server as { _registeredTools: Record<string, unknown> })._registeredTools);
}

/** The `:done` line, which records the mode this request resolved to. */
function doneLine(spy: ReturnType<typeof jest.spyOn>): string | undefined {
  return spy.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .find((l: string) => l.includes("createPerRequestServer:done"));
}

describe("createPerRequestServer with a rejected refresh token", () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    refreshFailure = undefined;
    rejectedRefreshToken = "rt-rejected";
    storedRefreshToken = "rt-rejected";
    kvDelete.mockClear();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("degrades to the authentication-expired server on a definitive invalid_grant", async () => {
    refreshFailure = {
      ok: false,
      reason: "expired",
      status: 400,
      error: "invalid_grant",
      message: "rejected",
    };

    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, env, props);

    expect(toolNames(server)).toEqual(["authentication-expired"]);
    expect(doneLine(logSpy)).toContain("mode=degraded-auth-expired");
    expect(doneLine(logSpy)).toContain("cause=refresh-rejected");
  });

  it("tells the user why, and how to recover", async () => {
    refreshFailure = {
      ok: false,
      reason: "expired",
      status: 400,
      error: "invalid_grant",
      message: "rejected",
    };

    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, env, props);

    const tool = (server as unknown as {
      _registeredTools: Record<string, { handler: () => Promise<{ content: { text: string }[] }> }>;
    })._registeredTools["authentication-expired"];
    const result = await tool.handler();

    expect(result.content[0].text).toContain("disconnect and reconnect");
    expect(result.content[0].text).toContain("Umbraco:CMS:Global:TimeOut");
  });

  it("degrades to the authentication-expired server when Umbraco rejected the OAuth client", async () => {
    // Regression for #320: `misconfigured` used to be bucketed with the
    // transient reasons, so a bad client_id/secret handed back a full toolset
    // that 401'd on every single call, with nothing to tell an operator why.
    refreshFailure = {
      ok: false,
      reason: "misconfigured",
      status: 400,
      error: "invalid_client",
      message: "rejected",
    };

    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, env, props);

    expect(toolNames(server)).toEqual(["authentication-expired"]);
    expect(doneLine(logSpy)).toContain("mode=degraded-auth-expired");
    expect(doneLine(logSpy)).toContain("cause=refresh-rejected-misconfigured");
  });

  it("tells an administrator to fix the client registration rather than reconnect", async () => {
    refreshFailure = {
      ok: false,
      reason: "misconfigured",
      status: 400,
      error: "invalid_client",
      message: "rejected",
    };

    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, env, props);

    const tool = (server as unknown as {
      _registeredTools: Record<string, { handler: () => Promise<{ content: { text: string }[] }> }>;
    })._registeredTools["authentication-expired"];
    const result = await tool.handler();

    const text = result.content[0].text;
    expect(text).toContain("administrator");
    expect(text).toContain("client id");
    // Reconnecting replays the same broken credentials, so the expired-session
    // advice must not leak into this message.
    expect(text).not.toContain("Umbraco:CMS:Global:TimeOut");
    expect(text.toLowerCase()).not.toContain("disconnect and reconnect");
  });

  it("degrades to the authentication-expired server when Umbraco rejected the request itself", async () => {
    // A permanently narrowed scope (or a malformed request) fails the same
    // fixed param set on every retry forever — degrading here is what stops
    // the session from silently keeping a full, 401-ing toolset indefinitely.
    refreshFailure = {
      ok: false,
      reason: "request_rejected",
      status: 400,
      error: "invalid_scope",
      message: "rejected",
    };

    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, env, props);

    expect(toolNames(server)).toEqual(["authentication-expired"]);
    expect(doneLine(logSpy)).toContain("mode=degraded-auth-expired");
    expect(doneLine(logSpy)).toContain("cause=refresh-rejected-request");
  });

  it("tells an administrator to check scope/request handling rather than client credentials", async () => {
    refreshFailure = {
      ok: false,
      reason: "request_rejected",
      status: 400,
      error: "invalid_scope",
      message: "rejected",
    };

    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, env, props);

    const tool = (server as unknown as {
      _registeredTools: Record<string, { handler: () => Promise<{ content: { text: string }[] }> }>;
    })._registeredTools["authentication-expired"];
    const result = await tool.handler();

    const text = result.content[0].text;
    expect(text).toContain("administrator");
    expect(text).toContain("scope");
    // Distinct diagnostic from `misconfigured`: this isn't a client_id/secret
    // problem, and reconnecting replays the same rejected request.
    expect(text).not.toContain("Umbraco:CMS:Global:TimeOut");
    expect(text.toLowerCase()).not.toContain("disconnect and reconnect");
  });

  it("uses a distinct cause for each degrading reason", async () => {
    const causes: string[] = [];

    for (const reason of ["expired", "misconfigured", "request_rejected"] as const) {
      logSpy.mockClear();
      refreshFailure = { ok: false, reason, status: 400, message: "rejected" };

      const { createPerRequestServer } = await import("../create-server.js");
      await createPerRequestServer(baseOptions, env, props);

      causes.push(doneLine(logSpy)!.match(/cause=(\S+)/)![1]);
    }

    expect(new Set(causes).size).toBe(causes.length);
  });

  it.each([["network"], ["server_error"]] as const)(
    "keeps the full toolset when the refresh failed with %s",
    async (reason) => {
      refreshFailure = { ok: false, reason, message: "transient" };

      const { createPerRequestServer } = await import("../create-server.js");
      const server = await createPerRequestServer(baseOptions, env, props);

      // No collections are configured, so "full" means zero tools — crucially
      // NOT the degraded single-tool server. A blip must not strip a session.
      expect(toolNames(server)).toEqual([]);
      expect(doneLine(logSpy)).toContain("mode=full");
    }
  );

  it("builds the full server when no refresh ever failed", async () => {
    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, env, props);

    expect(toolNames(server)).toEqual([]);
    expect(doneLine(logSpy)).toContain("mode=full");
  });

  it("stamps the session id and tenant on the init span of a refresh-failure degraded start", async () => {
    // Regression for #371: the refresh-rejected branch must carry the same
    // session/tenant identity as the no-token-in-kv branch (spans.test.ts).
    refreshFailure = {
      ok: false,
      reason: "expired",
      status: 400,
      error: "invalid_grant",
      message: "rejected",
    };
    const { setTelemetryAdapter, clearTelemetryAdapter, TelemetryAttributes } = await import(
      "@umbraco-cms/mcp-server-sdk"
    );
    const { SERVER_INIT_SPAN, HostedTelemetryAttributes } = await import("../../telemetry/attributes.js");
    const recorded: { name: string; attributes: Record<string, unknown> }[] = [];
    setTelemetryAdapter({
      startSpan: (name, attributes, fn) => {
        const span = { name, attributes: { ...attributes } as Record<string, unknown> };
        recorded.push(span);
        return fn({ setAttribute: (key, value) => { span.attributes[key] = value; } });
      },
    });

    try {
      const { createPerRequestServer } = await import("../create-server.js");
      await createPerRequestServer(
        baseOptions,
        { ...env, TENANT_HASH_KEY: "tenant-hash-key" } as HostedMcpEnv,
        { ...props, consentChoices: { siteId: "my-site" } },
        "session-xyz",
      );
    } finally {
      clearTelemetryAdapter();
    }

    const init = recorded.find((s) => s.name === SERVER_INIT_SPAN)!;
    expect(doneLine(logSpy)).toContain("cause=refresh-rejected-expired");
    expect(init.attributes[HostedTelemetryAttributes.INIT_MODE]).toBe("degraded-auth-expired");
    expect(init.attributes[TelemetryAttributes.MCP_SESSION_ID]).toBe("session-xyz");
    expect(init.attributes[TelemetryAttributes.TENANT]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deletes the inner KV entry when the refresh token expired", async () => {
    // #371: with the entry gone, the API handler wrapper revokes the outer
    // grant and 401s the client back into a fresh sign-in.
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };

    const { createPerRequestServer } = await import("../create-server.js");
    await createPerRequestServer(baseOptions, env, props);

    expect(kvDelete).toHaveBeenCalledTimes(1);
    expect(kvDelete).toHaveBeenCalledWith(`umbraco_token:${props.umbracoTokenKey}`);
  });

  it("does NOT delete an entry rotated by a concurrent refresh", async () => {
    // `invalid_grant` is only definitive for the token posted. If another
    // request rotated the entry meanwhile, the session is alive.
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };
    storedRefreshToken = "rt-rotated-by-someone-else";

    const { createPerRequestServer } = await import("../create-server.js");
    await createPerRequestServer(baseOptions, env, props);

    expect(kvDelete).not.toHaveBeenCalled();
  });

  it("does not delete when the rejected refresh token is unknown", async () => {
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };
    rejectedRefreshToken = undefined;

    const { createPerRequestServer } = await import("../create-server.js");
    await createPerRequestServer(baseOptions, env, props);

    expect(kvDelete).not.toHaveBeenCalled();
  });

  it.each([["misconfigured"], ["request_rejected"], ["network"], ["server_error"]] as const)(
    "does not delete the inner KV entry when the refresh failed with %s",
    async (reason) => {
      // Signing in again can't fix a broken client/request, and a blip or 5xx
      // must not end a session — so only `expired` drops the entry.
      refreshFailure = { ok: false, reason, status: 400, message: "rejected" };

      const { createPerRequestServer } = await import("../create-server.js");
      await createPerRequestServer(baseOptions, env, props);

      expect(kvDelete).not.toHaveBeenCalled();
    }
  );

  it("does not delete the inner KV entry when no refresh failed", async () => {
    const { createPerRequestServer } = await import("../create-server.js");
    await createPerRequestServer(baseOptions, env, props);

    expect(kvDelete).not.toHaveBeenCalled();
  });

  it("still returns the degraded server when deleting the expired entry fails", async () => {
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };
    kvDelete.mockRejectedValueOnce(new Error("kv down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { createPerRequestServer } = await import("../create-server.js");
      const server = await createPerRequestServer(baseOptions, env, props);
      expect(toolNames(server)).toEqual(["authentication-expired"]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("isAuthExpiredServer recognises a real degraded server and rejects a real full one", async () => {
    // Every other test of `isAuthExpiredServer` (register-chained-tools.test.ts)
    // mocks it away entirely, so nothing exercises the real WeakSet-based
    // implementation against a server `createAuthExpiredServer` actually built.
    // Without this, `authExpiredServers.add(server)` being dropped, or called
    // on the wrong object, would pass every existing test.
    refreshFailure = {
      ok: false,
      reason: "expired",
      status: 400,
      error: "invalid_grant",
      message: "rejected",
    };

    const { createPerRequestServer, isAuthExpiredServer } = await import("../create-server.js");
    const degraded = await createPerRequestServer(baseOptions, env, props);
    expect(isAuthExpiredServer(degraded)).toBe(true);

    refreshFailure = undefined;
    const full = await createPerRequestServer(baseOptions, env, props);
    expect(isAuthExpiredServer(full)).toBe(false);
  });
});
