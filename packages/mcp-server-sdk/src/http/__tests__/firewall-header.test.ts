import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  initializeUmbracoFetch,
  UmbracoManagementClient,
  createUmbracoFetchClient,
  requestClientCredentialsToken,
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

// Issue #234: operators behind an IP allow-list firewall need a fixed,
// identifiable header on every request so a firewall rule can let it through.
describe("firewall-allowlist header", () => {
  describe("requestClientCredentialsToken", () => {
    it("sends the configured header on the token request", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }));

      await requestClientCredentialsToken({
        baseUrl: "https://example.com",
        clientId: "cid",
        clientSecret: "sec",
        headerValue: "secret-value",
      });

      const [, options] = mockFetch.mock.calls[0];
      expect((options as RequestInit).headers).toEqual(
        expect.objectContaining({ "X-Umbraco-Mcp": "secret-value" })
      );
    });

    it("uses a custom header name when provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }));

      await requestClientCredentialsToken({
        baseUrl: "https://example.com",
        clientId: "cid",
        clientSecret: "sec",
        headerName: "X-Custom-Header",
        headerValue: "secret-value",
      });

      const [, options] = mockFetch.mock.calls[0];
      expect((options as RequestInit).headers).toEqual(
        expect.objectContaining({ "X-Custom-Header": "secret-value" })
      );
    });

    it("sends no extra header when headerValue is unset", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }));

      await requestClientCredentialsToken({
        baseUrl: "https://example.com",
        clientId: "cid",
        clientSecret: "sec",
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(Object.keys((options as RequestInit).headers as Record<string, string>)).not.toContain(
        "X-Umbraco-Mcp"
      );
    });
  });

  describe("initializeUmbracoFetch (singleton)", () => {
    it("sends the header on both the token request and API calls", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      initializeUmbracoFetch({
        baseUrl: "https://example.com",
        clientId: "cid",
        clientSecret: "sec",
        headerValue: "secret-value",
      });

      await UmbracoManagementClient(
        { method: "get", url: "/umbraco/management/api/v1/item" },
        { returnFullResponse: true }
      );

      const [, tokenOptions] = mockFetch.mock.calls[0];
      const [, apiOptions] = mockFetch.mock.calls[1];
      expect((tokenOptions as RequestInit).headers).toEqual(
        expect.objectContaining({ "X-Umbraco-Mcp": "secret-value" })
      );
      expect((apiOptions as RequestInit).headers).toEqual(
        expect.objectContaining({ "X-Umbraco-Mcp": "secret-value" })
      );
    });

    it("sends no extra header when not configured", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      initializeUmbracoFetch({
        baseUrl: "https://example.com",
        clientId: "cid",
        clientSecret: "sec",
      });

      await UmbracoManagementClient(
        { method: "get", url: "/umbraco/management/api/v1/item" },
        { returnFullResponse: true }
      );

      const [, apiOptions] = mockFetch.mock.calls[1];
      expect(Object.keys((apiOptions as RequestInit).headers as Record<string, string>)).not.toContain(
        "X-Umbraco-Mcp"
      );
    });
  });

  describe("createUmbracoFetchClient (instance)", () => {
    it("sends the header on both the token request and API calls", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "t", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const { initialize, mutator } = createUmbracoFetchClient();
      initialize({
        baseUrl: "https://example.com",
        clientId: "cid",
        clientSecret: "sec",
        headerName: "X-Custom-Header",
        headerValue: "secret-value",
      });

      await mutator(
        { method: "get", url: "/umbraco/management/api/v1/item" },
        { returnFullResponse: true }
      );

      const [, tokenOptions] = mockFetch.mock.calls[0];
      const [, apiOptions] = mockFetch.mock.calls[1];
      expect((tokenOptions as RequestInit).headers).toEqual(
        expect.objectContaining({ "X-Custom-Header": "secret-value" })
      );
      expect((apiOptions as RequestInit).headers).toEqual(
        expect.objectContaining({ "X-Custom-Header": "secret-value" })
      );
    });
  });
});
