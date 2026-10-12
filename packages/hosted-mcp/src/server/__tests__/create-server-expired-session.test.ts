/**
 * Expired session with the version check off.
 *
 * `createPerRequestServer` now fires the `/server/information` request next to
 * `fetchCurrentUser` even when `expectedUmbracoMajor` is unset, so two
 * requests hit an expired access token at once. OpenIddict rotates the refresh
 * token on each redemption, so a second refresh would redeem a spent token.
 * Uses the real fetch client; only the token endpoint (`refreshUmbracoToken`)
 * and KV are stubbed.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../types/auth.js";

const mockRefresh = jest.fn<any>();
const mockFetch = jest.fn<typeof fetch>();

const actualTokenStorage = await import("../../auth/token-storage.js");
jest.unstable_mockModule("../../auth/token-storage.js", () => ({
  ...actualTokenStorage,
  refreshUmbracoToken: mockRefresh,
  getStoredUmbracoToken: jest.fn<any>().mockResolvedValue({
    tokens: { access_token: "expired-token", refresh_token: "refresh-1", expires_at: Date.now() - 1000 },
  }),
}));

const env = {
  UMBRACO_BASE_URL: "https://example.com",
  UMBRACO_OAUTH_CLIENT_ID: "test-client",
  COOKIE_ENCRYPTION_KEY: "0".repeat(64),
  OAUTH_KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
} as unknown as HostedMcpEnv;

const props: AuthProps = { userId: "user-1", userName: "Test User", umbracoTokenKey: "token-key" };

const options = {
  name: "test-server",
  version: "1.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

const toolNames = (server: unknown): string[] =>
  Object.keys((server as { _registeredTools: Record<string, unknown> })._registeredTools);

describe("createPerRequestServer with an expired token and the version check off", () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    mockRefresh.mockReset();
    mockFetch.mockReset();
    (globalThis as any).fetch = mockFetch;
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("refreshes exactly once and still degrades when the refresh is rejected", async () => {
    mockFetch.mockImplementation((async () => new Response(null, { status: 401 })) as typeof fetch);
    mockRefresh.mockResolvedValue({ ok: false, reason: "expired", status: 400, error: "invalid_grant", message: "rejected" });

    const { createPerRequestServer } = await import("../create-server.js");
    expect(options).not.toHaveProperty("expectedUmbracoMajor");
    const server = await createPerRequestServer(options, env, props);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(toolNames(server)).toEqual(["authentication-expired"]);
  });

  it("refreshes exactly once and builds the full server when the refresh succeeds", async () => {
    mockRefresh.mockResolvedValue({ ok: true, accessToken: "fresh-token", refreshToken: "refresh-2", expiresAt: Date.now() + 60_000 });
    mockFetch.mockImplementation((async (_url: unknown, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (auth !== "Bearer fresh-token") return new Response(null, { status: 401 });
      return new Response(JSON.stringify({ version: "17.6.0" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);

    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(options, env, props);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(toolNames(server)).not.toContain("authentication-expired");
  });
});
