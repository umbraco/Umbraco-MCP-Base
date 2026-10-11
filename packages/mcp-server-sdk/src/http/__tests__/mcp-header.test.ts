import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  initializeUmbracoFetch,
  UmbracoManagementClient,
  createUmbracoFetchClient,
  requestClientCredentialsToken,
} from "../umbraco-fetch-client.js";

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const headersOf = (call: number) =>
  new Headers(mockFetch.mock.calls[call][1]?.headers as Record<string, string>);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch
    .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600 }))
    .mockResolvedValueOnce(jsonResponse({ ok: true }));
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

const base = { baseUrl: "https://example.com", clientId: "cid", clientSecret: "sec" };
const req = { method: "get", url: "/umbraco/management/api/v1/item" };

describe("X-Umbraco-Mcp header (singleton)", () => {
  it("sends the default-named header on token and API requests when value is set", async () => {
    initializeUmbracoFetch({ ...base, headerValue: "s3cret" });
    await UmbracoManagementClient(req);
    expect(headersOf(0).get("X-Umbraco-Mcp")).toBe("s3cret");
    expect(headersOf(1).get("X-Umbraco-Mcp")).toBe("s3cret");
  });

  it("uses a custom header name", async () => {
    initializeUmbracoFetch({ ...base, headerName: "X-Custom", headerValue: "v" });
    await UmbracoManagementClient(req);
    expect(headersOf(0).get("X-Custom")).toBe("v");
    expect(headersOf(1).get("X-Custom")).toBe("v");
    expect(headersOf(1).has("X-Umbraco-Mcp")).toBe(false);
  });

  it("sends no header when value is unset", async () => {
    initializeUmbracoFetch({ ...base, headerName: "X-Custom" });
    await UmbracoManagementClient(req);
    expect(headersOf(0).has("X-Custom")).toBe(false);
    expect(headersOf(0).has("X-Umbraco-Mcp")).toBe(false);
    expect(headersOf(1).has("X-Custom")).toBe(false);
    expect(headersOf(1).has("X-Umbraco-Mcp")).toBe(false);
  });
});

describe("X-Umbraco-Mcp header (instance)", () => {
  it("sends the header on token and API requests when configured", async () => {
    const client = createUmbracoFetchClient();
    client.initialize({ ...base, headerValue: "s3cret" });
    await client.mutator(req);
    expect(headersOf(0).get("X-Umbraco-Mcp")).toBe("s3cret");
    expect(headersOf(1).get("X-Umbraco-Mcp")).toBe("s3cret");
  });

  it("sends no header when not configured", async () => {
    const client = createUmbracoFetchClient();
    client.initialize(base);
    await client.mutator(req);
    expect(headersOf(0).has("X-Umbraco-Mcp")).toBe(false);
    expect(headersOf(1).has("X-Umbraco-Mcp")).toBe(false);
  });
});

describe("requestClientCredentialsToken", () => {
  it("includes the header only when a value is given", async () => {
    await requestClientCredentialsToken({ ...base, headerValue: "v" });
    expect(headersOf(0).get("X-Umbraco-Mcp")).toBe("v");
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 1 }));
    await requestClientCredentialsToken(base);
    expect(headersOf(1).has("X-Umbraco-Mcp")).toBe(false);
  });
});
