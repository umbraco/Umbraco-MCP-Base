/**
 * Hosted-Worker Span Tests
 *
 * Covers the two spans that sit alongside existing diagnostics:
 * `mcp.server.init` and `mcp.auth.refresh`.
 *
 * The log lines are asserted too, not just the spans. Keeping them is a
 * deliberate decision — the trace id can't be read at runtime, so the
 * hand-rolled correlation id is still the only way to tie `:start` to `:done`
 * on `wrangler tail`. A future "tidy-up" that deletes them should fail here.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { setTelemetryAdapter, clearTelemetryAdapter } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../types/auth.js";
import { SERVER_INIT_SPAN, AUTH_REFRESH_SPAN, HostedTelemetryAttributes } from "../attributes.js";

interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
}

let spans: RecordedSpan[] = [];

function recordSpans() {
  spans = [];
  setTelemetryAdapter({
    startSpan: (name, attributes, fn) => {
      const recorded: RecordedSpan = { name, attributes: { ...attributes } };
      spans.push(recorded);
      return fn({
        setAttribute(key, value) {
          recorded.attributes[key] = value;
        },
      });
    },
  });
}

function spanNamed(name: string): RecordedSpan | undefined {
  return spans.find((s) => s.name === name);
}

// OAUTH_KV.get returning null drives createPerRequestServer down its
// degraded ("token expired") path, which needs no live Umbraco.
const degradedEnv = {
  UMBRACO_BASE_URL: "https://example.com",
  UMBRACO_OAUTH_CLIENT_ID: "test-client",
  COOKIE_ENCRYPTION_KEY: "0".repeat(64),
  OAUTH_KV: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
} as unknown as HostedMcpEnv;

const props: AuthProps = {
  userId: "user-1",
  userName: "Test User",
  umbracoTokenKey: "token-key",
};

const baseOptions = {
  name: "test-server",
  version: "9.9.9",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

describe("mcp.server.init span", () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    recordSpans();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    clearTelemetryAdapter();
  });

  it("opens an init span around server creation", async () => {
    const { createPerRequestServer } = await import("../../server/create-server.js");

    await createPerRequestServer(baseOptions, degradedEnv, props);

    expect(spanNamed(SERVER_INIT_SPAN)).toBeDefined();
  });

  it("records the degraded mode and tool count", async () => {
    const { createPerRequestServer } = await import("../../server/create-server.js");

    await createPerRequestServer(baseOptions, degradedEnv, props);

    expect(spanNamed(SERVER_INIT_SPAN)!.attributes).toMatchObject({
      [HostedTelemetryAttributes.INIT_MODE]: "degraded-auth-expired",
      [HostedTelemetryAttributes.INIT_TOOL_COUNT]: 1,
    });
  });

  it("keeps the :start and :done log lines with their correlation id", async () => {
    const { createPerRequestServer } = await import("../../server/create-server.js");

    await createPerRequestServer(baseOptions, degradedEnv, props);

    const lines = logSpy.mock.calls.map((args) => String(args[0]));
    const start = lines.find((l) => l.includes("createPerRequestServer:start"));
    const done = lines.find((l) => l.includes("createPerRequestServer:done"));

    expect(start).toBeDefined();
    expect(done).toBeDefined();
    // Cloudflare exposes no spanContext(), so this hand-rolled id is the only
    // thing tying the two lines together on `wrangler tail`. Don't remove it.
    expect(start).toMatch(/id=[a-z0-9]+/);
    expect(done).toMatch(/id=[a-z0-9]+/);
  });

  it("still returns a usable server when no adapter is registered", async () => {
    clearTelemetryAdapter();
    const { createPerRequestServer } = await import("../../server/create-server.js");

    const server = await createPerRequestServer(baseOptions, degradedEnv, props);

    expect(server).toBeDefined();
    expect(spans).toHaveLength(0);
  });
});

describe("mcp.auth.refresh span", () => {
  const originalFetch = globalThis.fetch;
  let logSpy: ReturnType<typeof jest.spyOn>;

  const refreshEnv = {
    UMBRACO_BASE_URL: "https://example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test-client",
    OAUTH_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
  } as unknown as HostedMcpEnv;

  beforeEach(() => {
    recordSpans();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    logSpy.mockRestore();
    clearTelemetryAdapter();
  });

  it("records a successful refresh", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const { refreshUmbracoToken } = await import("../../auth/token-storage.js");
    const token = await refreshUmbracoToken(refreshEnv, "token-key", "old-refresh");

    expect(token).toBe("new-access");
    expect(spanNamed(AUTH_REFRESH_SPAN)!.attributes).toMatchObject({
      [HostedTelemetryAttributes.AUTH_OUTCOME]: "refreshed",
      [HostedTelemetryAttributes.HTTP_STATUS]: 200,
      [HostedTelemetryAttributes.AUTH_ROTATED_REFRESH_TOKEN]: true,
    });
  });

  it("records a failed refresh with its status", async () => {
    globalThis.fetch = (async () =>
      new Response("invalid_grant", { status: 400 })) as typeof fetch;

    const { refreshUmbracoToken } = await import("../../auth/token-storage.js");
    const token = await refreshUmbracoToken(refreshEnv, "token-key", "expired-refresh");

    expect(token).toBeNull();
    expect(spanNamed(AUTH_REFRESH_SPAN)!.attributes).toMatchObject({
      [HostedTelemetryAttributes.AUTH_OUTCOME]: "failed",
      [HostedTelemetryAttributes.HTTP_STATUS]: 400,
    });
  });

  it("flags whether a per-site OAuth client was used", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: "a" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const { refreshUmbracoToken } = await import("../../auth/token-storage.js");
    await refreshUmbracoToken(refreshEnv, "token-key", "old", {
      baseUrl: "https://tenant.example.com",
      oauthClientId: "tenant-client",
    } as never);

    expect(spanNamed(AUTH_REFRESH_SPAN)!.attributes[HostedTelemetryAttributes.AUTH_SITE_CONTEXT]).toBe(
      true
    );
  });

  it("records nothing identifying — no token key, no response body", async () => {
    globalThis.fetch = (async () =>
      new Response("invalid_grant: user 42 at /Users/someone/site", { status: 400 })) as typeof fetch;

    const { refreshUmbracoToken } = await import("../../auth/token-storage.js");
    await refreshUmbracoToken(refreshEnv, "secret-token-key", "expired");

    // The logAuth lines deliberately carry the key and body for `wrangler tail`;
    // the span must not, because spans leave the account.
    const serialised = JSON.stringify(spanNamed(AUTH_REFRESH_SPAN));
    expect(serialised).not.toContain("secret-token-key");
    expect(serialised).not.toContain("invalid_grant");
    expect(serialised).not.toContain("/Users/someone");
    expect(serialised).not.toContain("expired");
  });
});
