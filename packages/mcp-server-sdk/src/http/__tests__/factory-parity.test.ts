import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createUmbracoFetchClient } from "../umbraco-fetch-client.js";
import { streamFormData } from "./stream-form-data.js";

// The factory client shares the singleton's request path (#446): caller
// headers in options are sent, and a refused token is replaced once.

const BASE_URL = "https://localhost:44391";
const API_URL = "/umbraco/management/api/v1/item";

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

let tokenRequests: number;
let apiResponder: (authorization: string | undefined) => Response;
let apiRequests: Array<{ authorization?: string; headers: Record<string, string> }>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tokenRejected(): Response {
  return json(401, {}, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
}

function makeClient() {
  const client = createUmbracoFetchClient();
  client.initialize({ baseUrl: BASE_URL, clientId: "cid", clientSecret: "sec" });
  return client;
}

beforeEach(() => {
  tokenRequests = 0;
  apiRequests = [];
  apiResponder = () => json(200, { ok: true });
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (input, init) => {
    if (String(input).includes("/security/back-office/token")) {
      tokenRequests++;
      return json(200, { access_token: `t${tokenRequests}`, expires_in: 300 });
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    apiRequests.push({ authorization: headers.Authorization, headers: { ...headers } });
    return apiResponder(headers.Authorization);
  });
  (globalThis as any).fetch = mockFetch;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  (globalThis as any).fetch = originalFetch;
});

describe("createUmbracoFetchClient request path (#446)", () => {
  it("sends the multipart Content-Type passed in options.headers for a stream FormData", async () => {
    const fd = streamFormData();
    await makeClient().mutator(
      { method: "POST", url: API_URL, data: fd },
      { headers: fd.getHeaders() }
    );
    expect(apiRequests[0].headers["content-type"]).toBe("multipart/form-data; boundary=x");
    expect(apiRequests[0].headers["Content-Type"]).toBeUndefined();
  });

  it("resends once with a fresh token after a bearer challenge, and caches it", async () => {
    apiResponder = (authorization) =>
      authorization === "Bearer t1" ? tokenRejected() : json(200, { ok: true });
    const client = makeClient();

    await expect(client.mutator({ method: "GET", url: API_URL })).resolves.toEqual({ ok: true });
    expect(apiRequests.map((r) => r.authorization)).toEqual(["Bearer t1", "Bearer t2"]);

    await client.mutator({ method: "GET", url: API_URL });
    expect(tokenRequests).toBe(2);
  });

  it("returns a 401 without a bearer challenge as is and keeps the token", async () => {
    apiResponder = () => json(401, { title: "Unauthorized" });

    const result: any = await makeClient().mutator(
      { method: "GET", url: API_URL },
      { returnFullResponse: true }
    );
    expect(result.status).toBe(401);
    expect(apiRequests).toHaveLength(1);
    expect(tokenRequests).toBe(1);
  });
});
