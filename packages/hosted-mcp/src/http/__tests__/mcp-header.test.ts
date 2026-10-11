import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { createUmbracoFetchClient, CAPTURE_RAW_HTTP_RESPONSE } from "../umbraco-fetch-client.js";
import { buildMcpHeader } from "../mcp-header.js";
import type { HostedMcpEnv } from "../../types/env.js";

const mockFetch = jest.fn<typeof fetch>();
(globalThis as any).fetch = mockFetch;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const headersOf = (call: number) =>
  new Headers(mockFetch.mock.calls[call][1]?.headers as Record<string, string>);

const baseConfig = { baseUrl: "https://umbraco.example.com", accessToken: "tok" };

function envWith(extra: Partial<HostedMcpEnv>): HostedMcpEnv {
  const kv = {
    get: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
    put: jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  };
  return {
    UMBRACO_BASE_URL: "https://umbraco.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "client-id",
    UMBRACO_OAUTH_CLIENT_SECRET: "client-secret",
    COOKIE_ENCRYPTION_KEY: "key",
    OAUTH_KV: kv,
    MCP_AGENT: {},
    OAUTH_PROVIDER: {},
    ...extra,
  } as unknown as HostedMcpEnv;
}

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("buildMcpHeader", () => {
  it("is empty when the value is unset", () => {
    expect(buildMcpHeader({ UMBRACO_MCP_HEADER_NAME: "X-Foo" })).toEqual({});
    expect(buildMcpHeader(undefined)).toEqual({});
  });
  it("uses the default name, or a custom one", () => {
    expect(buildMcpHeader({ UMBRACO_MCP_HEADER_VALUE: "v" })).toEqual({ "X-Umbraco-Mcp": "v" });
    expect(
      buildMcpHeader({ UMBRACO_MCP_HEADER_NAME: "X-Foo", UMBRACO_MCP_HEADER_VALUE: "v" })
    ).toEqual({ "X-Foo": "v" });
  });
});

describe("X-Umbraco-Mcp header on API requests", () => {
  it("is sent when configured", async () => {
    mockFetch.mockResolvedValue(json(200, {}));
    const client = createUmbracoFetchClient({ ...baseConfig, headerValue: "s3cret" });
    await client({ method: "get", url: "/x" }, CAPTURE_RAW_HTTP_RESPONSE);
    expect(headersOf(0).get("X-Umbraco-Mcp")).toBe("s3cret");
  });

  it("uses a custom name", async () => {
    mockFetch.mockResolvedValue(json(200, {}));
    const client = createUmbracoFetchClient({ ...baseConfig, headerName: "X-Foo", headerValue: "v" });
    await client({ method: "get", url: "/x" }, CAPTURE_RAW_HTTP_RESPONSE);
    expect(headersOf(0).get("X-Foo")).toBe("v");
    expect(headersOf(0).has("X-Umbraco-Mcp")).toBe(false);
  });

  it("is absent when not configured", async () => {
    mockFetch.mockResolvedValue(json(200, {}));
    const client = createUmbracoFetchClient(baseConfig);
    await client({ method: "get", url: "/x" }, CAPTURE_RAW_HTTP_RESPONSE);
    expect(headersOf(0).has("X-Umbraco-Mcp")).toBe(false);
  });
});

describe("X-Umbraco-Mcp header on token refresh", () => {
  const run = async (env: HostedMcpEnv) => {
    mockFetch
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, { access_token: "n", refresh_token: "r2", expires_in: 3600 }))
      .mockResolvedValueOnce(json(200, {}));
    const client = createUmbracoFetchClient({
      ...baseConfig,
      refreshContext: { env, tokenKey: "k", refreshToken: "r1" },
    });
    await client({ method: "get", url: "/x" }, CAPTURE_RAW_HTTP_RESPONSE);
  };

  it("is sent on the refresh request when configured", async () => {
    await run(envWith({ UMBRACO_MCP_HEADER_VALUE: "s3cret" }));
    expect(headersOf(1).get("X-Umbraco-Mcp")).toBe("s3cret");
  });

  it("is absent on the refresh request when not configured", async () => {
    await run(envWith({}));
    expect(headersOf(1).has("X-Umbraco-Mcp")).toBe(false);
  });
});
