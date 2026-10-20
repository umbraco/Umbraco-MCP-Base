import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  initializeUmbracoFetch,
  clearUmbracoFetchToken,
  UmbracoManagementClient,
} from "../umbraco-fetch-client.js";

// Regression for #401: the singleton client's client-credentials token cache
// (single flight, expiry margin, one retry after a 401).

const BASE_URL = "https://example.com";
const API_URL = "/umbraco/management/api/v1/item";
const START = new Date("2026-01-01T00:00:00Z").getTime();

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

let tokenRequests: number;
let tokenResponder: () => Promise<Response>;
let apiResponder: (authorization: string | undefined) => Response;
let apiRequests: Array<{ method?: string; authorization?: string; body?: unknown }>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(token: string, expiresIn = 300): Response {
  return json(200, { access_token: token, expires_in: expiresIn });
}

/** Serves tokens t1, t2, … in order, each with the given lifetime. */
function issueTokens(expiresIn = 300): void {
  tokenResponder = async () => tokenResponse(`t${tokenRequests}`, expiresIn);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function get(options: Record<string, unknown> = { returnFullResponse: true }): Promise<any> {
  return UmbracoManagementClient({ method: "GET", url: API_URL }, options);
}

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  tokenRequests = 0;
  apiRequests = [];
  issueTokens();
  apiResponder = () => json(200, { ok: true });

  mockFetch.mockReset();
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/security/back-office/token")) {
      tokenRequests++;
      return tokenResponder();
    }
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    apiRequests.push({ method: init?.method, authorization, body: init?.body });
    return apiResponder(authorization);
  });
  (globalThis as any).fetch = mockFetch;
  jest.spyOn(console, "error").mockImplementation(() => {});

  initializeUmbracoFetch({ baseUrl: BASE_URL, clientId: "cid", clientSecret: "sec" });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  (globalThis as any).fetch = originalFetch;
});

describe("client-credentials token cache (#401)", () => {
  it("1. concurrent calls share one token request, on cold start and after expiry", async () => {
    await Promise.all(Array.from({ length: 8 }, () => get()));
    expect(tokenRequests).toBe(1);
    expect(apiRequests.map((r) => r.authorization)).toEqual(Array(8).fill("Bearer t1"));

    jest.setSystemTime(START + 300_000);
    apiRequests = [];
    await Promise.all(Array.from({ length: 8 }, () => get()));
    expect(tokenRequests).toBe(2);
    expect(apiRequests.map((r) => r.authorization)).toEqual(Array(8).fill("Bearer t2"));
  });

  it("2. a failed token request reaches every waiting caller and isn't cached", async () => {
    tokenResponder = async () => json(500, {});

    const results = await Promise.allSettled(Array.from({ length: 3 }, () => get()));
    expect(tokenRequests).toBe(1);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason.message).toMatch(/Token request failed: 500/);
    }

    issueTokens();
    const result = await get();
    expect(result.status).toBe(200);
    expect(tokenRequests).toBe(2);
    expect(apiRequests.at(-1)?.authorization).toBe("Bearer t2");
  });

  it.each([
    ["clearUmbracoFetchToken", () => clearUmbracoFetchToken()],
    ["initializeUmbracoFetch", () =>
      initializeUmbracoFetch({ baseUrl: BASE_URL, clientId: "cid2", clientSecret: "sec2" })],
  ])("3. a token request in flight during %s is not stored", async (_name, reset) => {
    const late = deferred<Response>();
    tokenResponder = () => late.promise;

    const first = get();
    await jest.advanceTimersByTimeAsync(0);
    expect(tokenRequests).toBe(1);

    reset();
    late.resolve(tokenResponse("stale"));
    await first;

    issueTokens();
    await get();
    expect(tokenRequests).toBe(2);
    expect(apiRequests.at(-1)?.authorization).toBe("Bearer t2");
  });

  it.each([
    // [expires_in (s), margin (s)]
    [300, 30],
    [3600, 30],
    [60, 6],
  ])("4. a %is token is replaced within %is of expiry and reused outside it", async (expiresIn, margin) => {
    issueTokens(expiresIn);
    await get();
    expect(tokenRequests).toBe(1);

    jest.setSystemTime(START + (expiresIn - margin) * 1000 - 1);
    await get();
    expect(tokenRequests).toBe(1);
    expect(apiRequests.at(-1)?.authorization).toBe("Bearer t1");

    jest.setSystemTime(START + (expiresIn - margin) * 1000);
    await get();
    expect(tokenRequests).toBe(2);
    expect(apiRequests.at(-1)?.authorization).toBe("Bearer t2");
  });

  describe("5. retry once on 401 with a fresh token", () => {
    beforeEach(() => {
      apiResponder = (authorization) =>
        authorization === "Bearer t1" ? json(401, {}) : json(200, { ok: true });
    });

    it("returnFullResponse returns the 200 from the retry", async () => {
      const result = await get();
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ ok: true });
      expect(tokenRequests).toBe(2);
      expect(apiRequests.map((r) => r.authorization)).toEqual(["Bearer t1", "Bearer t2"]);

      // The fresh token is cached for the next call.
      await get();
      expect(tokenRequests).toBe(2);
    });

    it("the throw path returns the data from the retry", async () => {
      await expect(get({})).resolves.toEqual({ ok: true });
      expect(tokenRequests).toBe(2);
    });

    it("resends a POST with the same body", async () => {
      const result: any = await UmbracoManagementClient(
        { method: "POST", url: API_URL, data: { name: "x" } },
        { returnFullResponse: true }
      );
      expect(result.status).toBe(200);
      expect(apiRequests.map((r) => [r.method, r.body])).toEqual([
        ["POST", JSON.stringify({ name: "x" })],
        ["POST", JSON.stringify({ name: "x" })],
      ]);
    });
  });

  describe("6. retry limits", () => {
    it("doesn't retry when the signal is aborted", async () => {
      apiResponder = () => json(401, {});
      const controller = new AbortController();
      controller.abort();

      const result = await get({ returnFullResponse: true, signal: controller.signal });
      expect(result.status).toBe(401);
      expect(apiRequests).toHaveLength(1);
      expect(tokenRequests).toBe(1);
    });

    it("retries only once: a second 401 is returned or thrown as before", async () => {
      apiResponder = () => json(401, {});

      const result = await get();
      expect(result.status).toBe(401);
      expect(apiRequests).toHaveLength(2);
      expect(tokenRequests).toBe(2);

      await expect(get({})).rejects.toThrow("Request failed with status 401: Unauthorized");
      expect(apiRequests).toHaveLength(4);
      expect(tokenRequests).toBe(3);
    });

    it("8 concurrent 401s for the same token cause one token request", async () => {
      await get();
      expect(tokenRequests).toBe(1);

      apiResponder = (authorization) =>
        authorization === "Bearer t1" ? json(401, {}) : json(200, { ok: true });
      const results = await Promise.all(Array.from({ length: 8 }, () => get()));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
      expect(tokenRequests).toBe(2);
    });

    it("doesn't retry or drop the cache when the caller sent its own Authorization", async () => {
      apiResponder = (authorization) =>
        authorization === "Bearer theirs" ? json(401, {}) : json(200, { ok: true });

      const result = await get({ returnFullResponse: true, headers: { Authorization: "Bearer theirs" } });
      expect(result.status).toBe(401);
      expect(apiRequests).toHaveLength(1);

      await get();
      expect(tokenRequests).toBe(1);
      expect(apiRequests.at(-1)?.authorization).toBe("Bearer t1");
    });
  });

  it("7. non-401 errors are not retried and keep the same error message", async () => {
    apiResponder = () => json(403, { title: "Forbidden" });

    const result = await get();
    expect(result.status).toBe(403);
    expect(result.data).toEqual({ title: "Forbidden" });

    await expect(get({})).rejects.toThrow("Request failed with status 403: Forbidden");
    expect(apiRequests).toHaveLength(2);
    expect(tokenRequests).toBe(1);
  });
});
