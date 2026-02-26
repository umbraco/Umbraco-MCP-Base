import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  createUmbracoFetchClient,
  CAPTURE_RAW_HTTP_RESPONSE,
} from "../umbraco-fetch-client.js";

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

beforeEach(() => {
  mockFetch.mockReset();
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
      });
    });
  });

  describe("token refresh", () => {
    it("retries with new token on 401 when refreshContext provided", async () => {
      // First call returns 401, refresh succeeds, retry returns 200
      const mockKV = {
        get: jest.fn().mockResolvedValue(
          JSON.stringify({
            access_token: "refreshed-token",
            refresh_token: "new-refresh",
          })
        ),
        put: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
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
      });
      // Should have made 3 fetch calls: original (401), refresh, retry
      expect(mockFetch).toHaveBeenCalledTimes(3);
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
