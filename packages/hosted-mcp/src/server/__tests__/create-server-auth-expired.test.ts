/**
 * Auth-expired start — refresh-rejection path.
 *
 * The no-token-in-KV path is covered in `telemetry/__tests__/spans.test.ts`.
 * This file covers the other half added for umbraco/Umbraco-MCP-Base#320: KV
 * still holds an entry, but Umbraco has definitively rejected its refresh token,
 * so the session is over even though a fetch client could be built. Since #451
 * that fails server creation with `UmbracoSignInUnavailableError` instead of
 * building the old one-tool `authentication-expired` server.
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

/**
 * Runs `createPerRequestServer` and returns the server it built or the error it
 * threw, so a test can assert on either without an unhandled rejection.
 */
async function start(
  startEnv: HostedMcpEnv = env,
  startProps: AuthProps = props,
  sessionId?: string
): Promise<{ server?: unknown; error?: unknown }> {
  const { createPerRequestServer } = await import("../create-server.js");
  try {
    return { server: await createPerRequestServer(baseOptions, startEnv, startProps, sessionId) };
  } catch (error) {
    return { error };
  }
}

/** Asserts `error` is the auth-expired error and returns it. */
async function expectSignInUnavailable(error: unknown): Promise<Error & { reason: string }> {
  const { UmbracoSignInUnavailableError } = await import("../create-server.js");
  expect(error).toBeInstanceOf(UmbracoSignInUnavailableError);
  return error as Error & { reason: string };
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

  it("fails the start with UmbracoSignInUnavailableError on a definitive invalid_grant", async () => {
    refreshFailure = {
      ok: false,
      reason: "expired",
      status: 400,
      error: "invalid_grant",
      message: "rejected",
    };

    const { server, error } = await start();

    expect(server).toBeUndefined();
    expect((await expectSignInUnavailable(error)).reason).toBe("refresh-rejected-expired");
    expect(doneLine(logSpy)).toContain("mode=auth-expired");
    expect(doneLine(logSpy)).toContain("cause=refresh-rejected");
  });

  it("never logs the raw site alias, only a keyed-hash reference", async () => {
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { error } = await start(
      { ...env, TENANT_HASH_KEY: "k".repeat(32) } as unknown as HostedMcpEnv,
      { ...props, consentChoices: { siteId: "secret-alias" } } as AuthProps
    );
    await expectSignInUnavailable(error);
    const lines = [...logSpy.mock.calls, ...errSpy.mock.calls].map((c: unknown[]) => String(c[0]));
    errSpy.mockRestore();
    expect(lines.some((l: string) => l.includes("createPerRequestServer:start"))).toBe(true);
    for (const l of lines) expect(l).not.toContain("secret-alias");
    expect(lines.find((l: string) => l.includes("createPerRequestServer:done"))).toBeDefined();
    expect(lines.find((l: string) => l.includes(":start"))).toMatch(/siteId=[0-9a-f]{12}/);
  });

  it("says why in the error, and that signing in again recovers", async () => {
    refreshFailure = {
      ok: false,
      reason: "expired",
      status: 400,
      error: "invalid_grant",
      message: "rejected",
    };

    const { error } = await start();
    const { message } = await expectSignInUnavailable(error);

    expect(message).toContain("sign in again");
    expect(message).toContain("Umbraco:CMS:Global:TimeOut");
  });

  it("fails the start when Umbraco rejected the OAuth client", async () => {
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

    const { error } = await start();

    expect((await expectSignInUnavailable(error)).reason).toBe("refresh-rejected-misconfigured");
    expect(doneLine(logSpy)).toContain("mode=auth-expired");
    expect(doneLine(logSpy)).toContain("cause=refresh-rejected-misconfigured");
  });

  it("tells an administrator to fix the client registration rather than sign in again", async () => {
    refreshFailure = {
      ok: false,
      reason: "misconfigured",
      status: 400,
      error: "invalid_client",
      message: "rejected",
    };

    const { error } = await start();
    const text = (await expectSignInUnavailable(error)).message;
    expect(text).toContain("administrator");
    expect(text).toContain("client id");
    // Signing in again replays the same broken credentials, so the
    // expired-session advice must not leak into this message.
    expect(text).not.toContain("Umbraco:CMS:Global:TimeOut");
    expect(text.toLowerCase()).not.toContain("disconnect and reconnect");
  });

  it("fails the start when Umbraco rejected the request itself", async () => {
    // A permanently narrowed scope (or a malformed request) fails the same
    // fixed param set on every retry forever — failing here is what stops
    // the session from silently keeping a full, 401-ing toolset indefinitely.
    refreshFailure = {
      ok: false,
      reason: "request_rejected",
      status: 400,
      error: "invalid_scope",
      message: "rejected",
    };

    const { error } = await start();

    expect((await expectSignInUnavailable(error)).reason).toBe("refresh-rejected-request");
    expect(doneLine(logSpy)).toContain("mode=auth-expired");
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

    const { error } = await start();
    const text = (await expectSignInUnavailable(error)).message;
    expect(text).toContain("administrator");
    expect(text).toContain("scope");
    // Distinct diagnostic from `misconfigured`: this isn't a client_id/secret
    // problem, and reconnecting replays the same rejected request.
    expect(text).not.toContain("Umbraco:CMS:Global:TimeOut");
    expect(text.toLowerCase()).not.toContain("disconnect and reconnect");
  });

  it("uses a distinct cause for each unusable-session reason", async () => {
    const causes: string[] = [];

    for (const reason of ["expired", "misconfigured", "request_rejected"] as const) {
      logSpy.mockClear();
      refreshFailure = { ok: false, reason, status: 400, message: "rejected" };

      await expectSignInUnavailable((await start()).error);

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
      // NOT a failed start. A blip must not strip a session.
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

  it("stamps the session id and tenant on the init span of a refresh-failure auth-expired start", async () => {
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
      const { error } = await start(
        { ...env, TENANT_HASH_KEY: "tenant-hash-key" } as HostedMcpEnv,
        { ...props, consentChoices: { siteId: "my-site" } },
        "session-xyz",
      );
      await expectSignInUnavailable(error);
    } finally {
      clearTelemetryAdapter();
    }

    const init = recorded.find((s) => s.name === SERVER_INIT_SPAN)!;
    expect(doneLine(logSpy)).toContain("cause=refresh-rejected-expired");
    expect(init.attributes[HostedTelemetryAttributes.INIT_MODE]).toBe("auth-expired");
    expect(init.attributes[TelemetryAttributes.MCP_SESSION_ID]).toBe("session-xyz");
    expect(init.attributes[TelemetryAttributes.TENANT]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deletes the inner KV entry when the refresh token expired", async () => {
    // #371: with the entry gone, the API handler wrapper revokes the outer
    // grant and 401s the client back into a fresh sign-in.
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };

    await expectSignInUnavailable((await start()).error);

    expect(kvDelete).toHaveBeenCalledTimes(1);
    expect(kvDelete).toHaveBeenCalledWith(`umbraco_token:${props.umbracoTokenKey}`);
  });

  it("does NOT delete an entry rotated by a concurrent refresh", async () => {
    // `invalid_grant` is only definitive for the token posted. If another
    // request rotated the entry meanwhile, the session is alive.
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };
    storedRefreshToken = "rt-rotated-by-someone-else";

    await start();

    expect(kvDelete).not.toHaveBeenCalled();
  });

  it("does not delete when the rejected refresh token is unknown", async () => {
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };
    rejectedRefreshToken = undefined;

    await start();

    expect(kvDelete).not.toHaveBeenCalled();
  });

  it.each([["misconfigured"], ["request_rejected"], ["network"], ["server_error"]] as const)(
    "does not delete the inner KV entry when the refresh failed with %s",
    async (reason) => {
      // Signing in again can't fix a broken client/request, and a blip or 5xx
      // must not end a session — so only `expired` drops the entry.
      refreshFailure = { ok: false, reason, status: 400, message: "rejected" };

      await start();

      expect(kvDelete).not.toHaveBeenCalled();
    }
  );

  it("does not delete the inner KV entry when no refresh failed", async () => {
    const { createPerRequestServer } = await import("../create-server.js");
    await createPerRequestServer(baseOptions, env, props);

    expect(kvDelete).not.toHaveBeenCalled();
  });

  it("still fails the start with UmbracoSignInUnavailableError when deleting the expired entry fails", async () => {
    refreshFailure = { ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" };
    kvDelete.mockRejectedValueOnce(new Error("kv down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { error } = await start();
      expect((await expectSignInUnavailable(error)).reason).toBe("refresh-rejected-expired");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stamps the tenant but no session id on a refresh-failure auth-expired start without a session id", async () => {
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
      const { error } = await start(
        { ...env, TENANT_HASH_KEY: "tenant-hash-key" } as HostedMcpEnv,
        { ...props, consentChoices: { siteId: "my-site" } },
      );
      await expectSignInUnavailable(error);
    } finally {
      clearTelemetryAdapter();
    }

    const init = recorded.find((s) => s.name === SERVER_INIT_SPAN)!;
    expect(init.attributes[HostedTelemetryAttributes.INIT_MODE]).toBe("auth-expired");
    expect(init.attributes[TelemetryAttributes.TENANT]).toMatch(/^[0-9a-f]{64}$/);
    expect(TelemetryAttributes.MCP_SESSION_ID in init.attributes).toBe(false);
  });
});
