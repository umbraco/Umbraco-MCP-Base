import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  createUmbracoFetchClient,
  CAPTURE_RAW_HTTP_RESPONSE,
} from "../umbraco-fetch-client.js";
import type { HostedMcpEnv } from "../../types/env.js";

// Mock global fetch
const mockFetch = jest.fn<typeof fetch>();
(globalThis as any).fetch = mockFetch;

function createJsonResponse(
  status: number,
  body: unknown,
  statusText = "OK"
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Minimal Worker env for the refresh path. `refreshUmbracoToken` builds the
 * token endpoint from UMBRACO_BASE_URL via getBackofficeEndpoints(), so no
 * discovery fetch is involved.
 */
function refreshEnv(kv: unknown): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://umbraco.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "client-id",
    UMBRACO_OAUTH_CLIENT_SECRET: "client-secret",
    COOKIE_ENCRYPTION_KEY: "key",
    OAUTH_KV: kv,
    MCP_AGENT: {},
    OAUTH_PROVIDER: {},
  } as unknown as HostedMcpEnv;
}

// A failed refresh now warns unconditionally (that's the point of #320), so
// keep the suite's output clean without hiding the assertions that read it.
let warnSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockFetch.mockReset();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("createUmbracoFetchClient", () => {
  const baseConfig = {
    baseUrl: "https://umbraco.example.com",
    accessToken: "test-token-123",
  };

  describe("request construction", () => {
    it("sends GET request with Authorization header", async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse(200, { id: "1", name: "Test" })
      );

      const client = createUmbracoFetchClient(baseConfig);
      await client(
        { method: "get", url: "/umbraco/api/v1/items" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://umbraco.example.com/umbraco/api/v1/items");
      expect((options as RequestInit).method).toBe("get");
      expect((options as RequestInit).headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer test-token-123",
        })
      );
    });

    it("sends POST request with JSON body", async () => {
      mockFetch.mockResolvedValue(createJsonResponse(201, null));

      const client = createUmbracoFetchClient(baseConfig);
      await client(
        {
          method: "post",
          url: "/umbraco/api/v1/items",
          data: { name: "New Item" },
        },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      const [, options] = mockFetch.mock.calls[0];
      expect((options as RequestInit).body).toBe(
        JSON.stringify({ name: "New Item" })
      );
    });

    it("does not include body for GET requests", async () => {
      mockFetch.mockResolvedValue(createJsonResponse(200, []));

      const client = createUmbracoFetchClient(baseConfig);
      await client(
        { method: "get", url: "/umbraco/api/v1/items" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      const [, options] = mockFetch.mock.calls[0];
      expect((options as RequestInit).body).toBeUndefined();
    });

    it.each([
      ["no trailing slash", "https://umbraco.example.com"],
      ["one trailing slash", "https://umbraco.example.com/"],
      ["multiple trailing slashes", "https://umbraco.example.com///"],
    ])("normalizes baseUrl with %s", async (_label, baseUrl) => {
      mockFetch.mockResolvedValue(createJsonResponse(200, []));

      const client = createUmbracoFetchClient({
        baseUrl,
        accessToken: "test-token-123",
      });
      await client(
        { method: "get", url: "/umbraco/api/v1/items" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://umbraco.example.com/umbraco/api/v1/items");
    });
  });

  describe("query parameter serialization", () => {
    it("serializes simple params", async () => {
      mockFetch.mockResolvedValue(createJsonResponse(200, []));

      const client = createUmbracoFetchClient(baseConfig);
      await client(
        {
          method: "get",
          url: "/api/items",
          params: { skip: 0, take: 10 },
        },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("?");
      expect(url).toContain("skip=0");
      expect(url).toContain("take=10");
    });

    it("serializes array params in repeat format", async () => {
      mockFetch.mockResolvedValue(createJsonResponse(200, []));

      const client = createUmbracoFetchClient(baseConfig);
      await client(
        {
          method: "get",
          url: "/api/items",
          params: { id: ["aaa", "bbb", "ccc"] },
        },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("id=aaa");
      expect(url).toContain("id=bbb");
      expect(url).toContain("id=ccc");
    });

    it("skips null and undefined params", async () => {
      mockFetch.mockResolvedValue(createJsonResponse(200, []));

      const client = createUmbracoFetchClient(baseConfig);
      await client(
        {
          method: "get",
          url: "/api/items",
          params: { a: "1", b: null, c: undefined },
        },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("a=1");
      expect(url).not.toContain("b=");
      expect(url).not.toContain("c=");
    });

    it("does not append ? when no params", async () => {
      mockFetch.mockResolvedValue(createJsonResponse(200, []));

      const client = createUmbracoFetchClient(baseConfig);
      await client(
        { method: "get", url: "/api/items" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://umbraco.example.com/api/items");
    });
  });

  describe("response handling", () => {
    it("returns HttpResponse when returnFullResponse is true", async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse(200, { id: "1", name: "Test" })
      );

      const client = createUmbracoFetchClient(baseConfig);
      const result = await client(
        { method: "get", url: "/api/items/1" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(result).toEqual({
        status: 200,
        statusText: "OK",
        data: { id: "1", name: "Test" },
        headers: { "content-type": "application/json" },
      });
    });

    it("returns just data without returnFullResponse", async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse(200, { id: "1", name: "Test" })
      );

      const client = createUmbracoFetchClient(baseConfig);
      const result = await client({ method: "get", url: "/api/items/1" });

      expect(result).toEqual({ id: "1", name: "Test" });
    });

    it("returns error HttpResponse for 4xx when returnFullResponse", async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse(404, {
          type: "Not Found",
          title: "Not Found",
          status: 404,
          detail: "Item not found",
        })
      );

      const client = createUmbracoFetchClient(baseConfig);
      const result = await client(
        { method: "get", url: "/api/items/999" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(result).toEqual({
        status: 404,
        statusText: "OK",
        data: expect.objectContaining({ status: 404 }),
        headers: { "content-type": "application/json" },
      });
    });

    it("throws on 4xx without returnFullResponse", async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse(400, { title: "Bad Request", status: 400 })
      );

      const client = createUmbracoFetchClient(baseConfig);
      await expect(
        client({ method: "get", url: "/api/items" })
      ).rejects.toThrow("Request failed with status 400");
    });

    it("handles non-JSON responses", async () => {
      // Use 200 with text/plain since Node's Response disallows body with 204
      mockFetch.mockResolvedValue(
        new Response("OK", {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "text/plain" },
        })
      );

      const client = createUmbracoFetchClient(baseConfig);
      const result = await client(
        { method: "delete", url: "/api/items/1" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(result).toEqual({
        status: 200,
        statusText: "OK",
        data: "OK",
        headers: { "content-type": "text/plain" },
      });
    });

    // Regression for #143: Umbraco 18 returns error bodies as
    // `application/problem+json` (RFC 7807), which does not contain
    // `application/json`. These must still be parsed as objects.
    it("parses application/problem+json error bodies as objects", async () => {
      const problemBody = {
        type: "Error",
        title: "The folder could not be found",
        status: 404,
        operationStatus: "NotFound",
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(problemBody), {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "application/problem+json; charset=utf-8" },
        })
      );

      const client = createUmbracoFetchClient(baseConfig);
      const result = await client(
        { method: "delete", url: "/api/data-type/folder/x" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(result).toEqual(
        expect.objectContaining({
          status: 404,
          data: problemBody,
        })
      );
    });
  });

  describe("token refresh", () => {
    it("retries with new token on 401 when refreshContext provided", async () => {
      // First call returns 401, refresh succeeds, retry returns 200
      const mockKV = {
        get: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(
          JSON.stringify({
            access_token: "refreshed-token",
            refresh_token: "new-refresh",
          })
        ),
        put: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
        delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      };

      // refreshUmbracoToken uses getBackofficeEndpoints() which constructs
      // URLs directly from UMBRACO_BASE_URL — no discovery fetch needed.
      mockFetch
        .mockResolvedValueOnce(
          // First API call - 401
          createJsonResponse(401, { error: "unauthorized" })
        )
        .mockResolvedValueOnce(
          // Token refresh (POST to backoffice token endpoint)
          createJsonResponse(200, {
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            expires_in: 3600,
          })
        )
        .mockResolvedValueOnce(
          // Retried API call with new token
          createJsonResponse(200, { id: "1", name: "Test" })
        );

      const client = createUmbracoFetchClient({
        ...baseConfig,
        refreshContext: {
          env: {
            UMBRACO_BASE_URL: "https://umbraco.example.com",
            UMBRACO_OAUTH_CLIENT_ID: "client-id",
            UMBRACO_OAUTH_CLIENT_SECRET: "client-secret",
            COOKIE_ENCRYPTION_KEY: "key",
            OAUTH_KV: mockKV as any,
            MCP_AGENT: {} as any,
            OAUTH_PROVIDER: {} as any,
          },
          tokenKey: "test-key",
          refreshToken: "old-refresh-token",
        },
      });

      const result = await client(
        { method: "get", url: "/api/items/1" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(result).toEqual({
        status: 200,
        statusText: "OK",
        data: { id: "1", name: "Test" },
        headers: { "content-type": "application/json" },
      });
      // Should have made 3 fetch calls: original (401), refresh, retry
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    // Regression for #320: OpenIddict rotates the refresh token on every
    // redemption, so a client that kept replaying `config.refreshContext
    // .refreshToken` could refresh exactly once — the second attempt came back
    // `400 invalid_grant, "already been redeemed"`.
    it("adopts the rotated refresh token so a second refresh uses the new one", async () => {
      const kvStore = new Map<string, string>();
      const mockKV = {
        get: jest.fn<(key: string) => Promise<string | null>>(async (key) =>
          kvStore.get(key) ?? null
        ),
        put: jest.fn<(key: string, value: string) => Promise<void>>(async (key, value) => {
          kvStore.set(key, value);
        }),
        delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      };

      const client = createUmbracoFetchClient({
        ...baseConfig,
        refreshContext: {
          env: refreshEnv(mockKV),
          tokenKey: "rotation-key",
          refreshToken: "refresh-1",
        },
      });

      // Round 1: 401 → refresh (issues refresh-2) → retry 200
      mockFetch
        .mockResolvedValueOnce(createJsonResponse(401, {}))
        .mockResolvedValueOnce(
          createJsonResponse(200, {
            access_token: "access-2",
            refresh_token: "refresh-2",
          })
        )
        .mockResolvedValueOnce(createJsonResponse(200, { round: 1 }));

      await client({ method: "get", url: "/api/items" }, CAPTURE_RAW_HTTP_RESPONSE);

      // Round 2: 401 again → refresh must present refresh-2, not refresh-1
      mockFetch
        .mockResolvedValueOnce(createJsonResponse(401, {}))
        .mockResolvedValueOnce(
          createJsonResponse(200, {
            access_token: "access-3",
            refresh_token: "refresh-3",
          })
        )
        .mockResolvedValueOnce(createJsonResponse(200, { round: 2 }));

      const second = await client(
        { method: "get", url: "/api/items" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(second).toMatchObject({ status: 200, data: { round: 2 } });

      const refreshBodies = mockFetch.mock.calls
        .filter(([url]) => String(url).includes("/security/back-office/token"))
        .map(([, init]) => String((init as RequestInit).body));

      expect(refreshBodies).toHaveLength(2);
      expect(refreshBodies[0]).toContain("refresh_token=refresh-1");
      expect(refreshBodies[1]).toContain("refresh_token=refresh-2");
      expect(refreshBodies[1]).not.toContain("refresh_token=refresh-1");

      // And the final request carried the newest access token.
      const lastInit = mockFetch.mock.calls.at(-1)![1] as RequestInit;
      expect(lastInit.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer access-3" })
      );
    });

    // Regression for #320: createPerRequestServer runs the version check and
    // the current-user fetch in parallel, so one expiry produced two
    // simultaneous token-endpoint POSTs replaying the same refresh token.
    it("coalesces concurrent 401s into exactly one token-endpoint POST", async () => {
      const mockKV = {
        get: jest.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(null),
        put: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
        delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      };

      let releaseRefresh: (() => void) | undefined;
      const refreshStarted = new Promise<void>((resolveStarted) => {
        mockFetch.mockImplementation(async (input, init) => {
          const url = String(input);
          if (url.includes("/security/back-office/token")) {
            resolveStarted();
            // Hold the refresh open so the second caller definitely arrives
            // while it's still in flight — the race the fix has to survive.
            await new Promise<void>((r) => {
              releaseRefresh = r;
            });
            return createJsonResponse(200, {
              access_token: "shared-access",
              refresh_token: "shared-refresh",
            });
          }
          const auth = (init?.headers as Record<string, string>)?.Authorization;
          return auth === "Bearer shared-access"
            ? createJsonResponse(200, { ok: true })
            : createJsonResponse(401, {});
        });
      });

      const client = createUmbracoFetchClient({
        ...baseConfig,
        refreshContext: {
          env: refreshEnv(mockKV),
          tokenKey: "concurrent-key",
          refreshToken: "shared-old-refresh",
        },
      });

      const first = client({ method: "get", url: "/api/a" }, CAPTURE_RAW_HTTP_RESPONSE);
      await refreshStarted;
      const second = client({ method: "get", url: "/api/b" }, CAPTURE_RAW_HTTP_RESPONSE);
      // Let the second request reach its own 401 and join the in-flight refresh.
      await new Promise((r) => setTimeout(r, 0));
      releaseRefresh!();

      const [a, b] = await Promise.all([first, second]);

      expect(a).toMatchObject({ status: 200, data: { ok: true } });
      expect(b).toMatchObject({ status: 200, data: { ok: true } });

      const tokenPosts = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes("/security/back-office/token")
      );
      expect(tokenPosts).toHaveLength(1);
      // One refresh means one KV write, so no rotated token is orphaned.
      expect(mockKV.put).toHaveBeenCalledTimes(1);
    });

    // Regression for #320: Umbraco's 401 has an empty body, so a dead session
    // surfaced as a bare `UmbracoApiError: Unauthorized` with nothing to act on.
    it("synthesizes an RFC 7807 problem body when the refresh is rejected with invalid_grant", async () => {
      const mockKV = {
        get: jest.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(null),
        put: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
        delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockFetch
        // Umbraco's real 401: no body at all.
        .mockResolvedValueOnce(new Response(null, { status: 401, statusText: "Unauthorized" }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        );

      const client = createUmbracoFetchClient({
        ...baseConfig,
        refreshContext: {
          env: refreshEnv(mockKV),
          tokenKey: "expired-key",
          refreshToken: "dead-refresh",
        },
      });

      const result = (await client(
        { method: "get", url: "/api/items" },
        CAPTURE_RAW_HTTP_RESPONSE
      )) as { status: number; headers: Record<string, string>; data: Record<string, unknown> };

      expect(result.status).toBe(401);
      expect(result.headers["content-type"]).toContain("application/problem+json");
      expect(result.data).toMatchObject({
        title: "Umbraco session expired",
        status: 401,
        refreshFailureReason: "expired",
        oauthError: "invalid_grant",
      });
      expect(String(result.data.detail)).toContain("disconnect and reconnect");
      // No retry: the refresh failed, so there are only two fetches.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(client.getRefreshFailure()).toMatchObject({
        ok: false,
        reason: "expired",
        status: 400,
        error: "invalid_grant",
      });
    });

    it("reports a network failure as transient, not as an expired session", async () => {
      const mockKV = {
        get: jest.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(null),
        put: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
        delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 401, statusText: "Unauthorized" }))
        .mockRejectedValueOnce(new Error("connection reset"));

      const client = createUmbracoFetchClient({
        ...baseConfig,
        refreshContext: {
          env: refreshEnv(mockKV),
          tokenKey: "blip-key",
          refreshToken: "live-refresh",
        },
      });

      const result = (await client(
        { method: "get", url: "/api/items" },
        CAPTURE_RAW_HTTP_RESPONSE
      )) as { status: number; data: Record<string, unknown> };

      expect(result.status).toBe(401);
      expect(result.data).toMatchObject({
        title: "Umbraco token refresh failed",
        refreshFailureReason: "network",
      });
      // `expired` is what strips a session's toolset — a blip must not claim it.
      expect(client.getRefreshFailure()?.reason).toBe("network");
    });

    it("prefers the refresh token persisted in KV over the caller's snapshot", async () => {
      const mockKV = {
        get: jest.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(
          JSON.stringify({
            tokens: { access_token: "kv-access", refresh_token: "kv-rotated-refresh" },
          })
        ),
        put: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
        delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockFetch
        .mockResolvedValueOnce(createJsonResponse(401, {}))
        .mockResolvedValueOnce(createJsonResponse(200, { access_token: "fresh-access" }))
        .mockResolvedValueOnce(createJsonResponse(200, { ok: true }));

      const client = createUmbracoFetchClient({
        ...baseConfig,
        refreshContext: {
          env: refreshEnv(mockKV),
          tokenKey: "stale-snapshot-key",
          refreshToken: "stale-in-memory-refresh",
        },
      });

      await client({ method: "get", url: "/api/items" }, CAPTURE_RAW_HTTP_RESPONSE);

      const [, refreshInit] = mockFetch.mock.calls[1];
      expect(String((refreshInit as RequestInit).body)).toContain(
        "refresh_token=kv-rotated-refresh"
      );
    });

    it("returns 401 when no refreshContext", async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse(401, { error: "unauthorized" })
      );

      const client = createUmbracoFetchClient(baseConfig);
      const result = await client(
        { method: "get", url: "/api/items/1" },
        CAPTURE_RAW_HTTP_RESPONSE
      );

      expect(result).toEqual({
        status: 401,
        statusText: "OK",
        data: { error: "unauthorized" },
        headers: { "content-type": "application/json" },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("CAPTURE_RAW_HTTP_RESPONSE", () => {
  it("has returnFullResponse: true", () => {
    expect(CAPTURE_RAW_HTTP_RESPONSE.returnFullResponse).toBe(true);
  });

  it("has validateStatus that always returns true", () => {
    expect(CAPTURE_RAW_HTTP_RESPONSE.validateStatus()).toBe(true);
  });
});
