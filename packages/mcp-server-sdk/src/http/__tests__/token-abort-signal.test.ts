/**
 * A request's abort signal must also bound the token exchange that precedes
 * it. Otherwise a CMS that accepts the connection but never answers the token
 * request hangs the caller whatever deadline it set
 * (umbraco/Umbraco-MCP-Base#428). Both token paths are covered: the singleton
 * (`initializeUmbracoFetch` + `UmbracoManagementClient`) and the per-instance
 * client from `createUmbracoFetchClient`.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  initializeUmbracoFetch,
  clearUmbracoFetchToken,
  UmbracoManagementClient,
  createUmbracoFetchClient,
} from "../umbraco-fetch-client.js";

const TOKEN_PATH = "/security/back-office/token";
const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock<typeof fetch>;

/** A token endpoint that never answers, but honours its request's signal. */
function stallTokenEndpoint() {
  fetchMock = jest.fn<typeof fetch>((input, init) => {
    if (!String(input).includes(TOKEN_PATH)) {
      return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (!signal) return; // Never settles — the bug this test guards against.
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

/** Fails the test (instead of hanging it) if the promise outlives `ms`. */
function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

const auth = { baseUrl: "https://localhost:44391", clientId: "client", clientSecret: "secret" };

beforeEach(() => stallTokenEndpoint());

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("token request abort signal", () => {
  it("UmbracoManagementClient (doFetch path) rejects with an abort once the signal fires during a stalled token request", async () => {
    initializeUmbracoFetch(auth);
    clearUmbracoFetchToken();

    const controller = new AbortController();
    const request = UmbracoManagementClient(
      { url: "/umbraco/management/api/v1/server/information", method: "GET" },
      { signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 20);

    await expect(settleWithin(request, 1000)).rejects.toMatchObject({ name: "AbortError" });
    const tokenCall = fetchMock.mock.calls.find(([input]) => String(input).includes(TOKEN_PATH));
    expect(tokenCall?.[1]?.signal).toBe(controller.signal);
  });

  it("createUmbracoFetchClient's mutator rejects with an abort once the signal fires during a stalled token request", async () => {
    const client = createUmbracoFetchClient();
    client.initialize(auth);

    const controller = new AbortController();
    const request = client.mutator(
      { url: "/umbraco/management/api/v1/server/information", method: "GET" },
      { signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 20);

    await expect(settleWithin(request, 1000)).rejects.toMatchObject({ name: "AbortError" });
    const tokenCall = fetchMock.mock.calls.find(([input]) => String(input).includes(TOKEN_PATH));
    expect(tokenCall?.[1]?.signal).toBe(controller.signal);
  });

  it("createUmbracoFetchClient's mutator forwards the signal to the API request too", async () => {
    globalThis.fetch = jest.fn<typeof fetch>((input) =>
      Promise.resolve(
        new Response(
          String(input).includes(TOKEN_PATH) ? JSON.stringify({ access_token: "t", expires_in: 300 }) : "{}",
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    ) as unknown as typeof fetch;
    const client = createUmbracoFetchClient();
    client.initialize(auth);
    const controller = new AbortController();

    await client.mutator({ url: "/x", method: "GET" }, { signal: controller.signal });

    const calls = (globalThis.fetch as unknown as jest.Mock<typeof fetch>).mock.calls;
    const apiCall = calls.find(([input]) => String(input).endsWith("/x"));
    expect(apiCall?.[1]?.signal).toBe(controller.signal);
  });
});
