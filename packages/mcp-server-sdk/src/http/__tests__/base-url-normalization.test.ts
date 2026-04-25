import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  initializeUmbracoFetch,
  UmbracoManagementClient,
  createUmbracoFetchClient,
} from "../umbraco-fetch-client.js";

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

describe("base URL trailing slash normalization", () => {
  describe("initializeUmbracoFetch (singleton)", () => {
    it.each([
      ["no trailing slash", "https://example.com"],
      ["one trailing slash", "https://example.com/"],
      ["multiple trailing slashes", "https://example.com///"],
    ])("normalizes baseUrl with %s", async (_label, baseUrl) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      initializeUmbracoFetch({
        baseUrl,
        clientId: "cid",
        clientSecret: "sec",
      });

      await UmbracoManagementClient(
        { method: "get", url: "/umbraco/management/api/v1/item" },
        { returnFullResponse: true }
      );

      const [tokenUrl] = mockFetch.mock.calls[0];
      const [apiUrl] = mockFetch.mock.calls[1];
      expect(tokenUrl).toBe(
        "https://example.com/umbraco/management/api/v1/security/back-office/token"
      );
      expect(apiUrl).toBe("https://example.com/umbraco/management/api/v1/item");
    });
  });

  describe("createUmbracoFetchClient (instance)", () => {
    it.each([
      ["no trailing slash", "https://example.com"],
      ["one trailing slash", "https://example.com/"],
      ["multiple trailing slashes", "https://example.com///"],
    ])("normalizes baseUrl with %s", async (_label, baseUrl) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const { initialize, mutator } = createUmbracoFetchClient();
      initialize({ baseUrl, clientId: "cid", clientSecret: "sec" });

      await mutator(
        { method: "get", url: "/umbraco/management/api/v1/item" },
        { returnFullResponse: true }
      );

      const [apiUrl] = mockFetch.mock.calls[1];
      expect(apiUrl).toBe("https://example.com/umbraco/management/api/v1/item");
    });
  });
});
