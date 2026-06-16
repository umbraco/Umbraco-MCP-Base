import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  initializeUmbracoFetch,
  UmbracoManagementClient,
  createUmbracoFetchClient,
} from "../umbraco-fetch-client.js";

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "t", expires_in: 3600 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function response(status: number, body: unknown, contentType: string): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: { "Content-Type": contentType } }
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

// Regression for #143: Umbraco 18 returns Management API error bodies as
// `application/problem+json` (RFC 7807). `"application/problem+json"` does NOT
// include `"application/json"`, so before the fix these were passed through as
// raw strings, breaking structured error handling (validateErrorResult).
describe("content-type response parsing", () => {
  const problemBody = {
    type: "Error",
    title: "The folder could not be found",
    status: 404,
    operationStatus: "NotFound",
  };

  describe("initializeUmbracoFetch (singleton)", () => {
    it("parses application/problem+json error bodies as objects", async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          response(404, problemBody, "application/problem+json; charset=utf-8")
        );

      initializeUmbracoFetch({ baseUrl: "https://example.com", clientId: "cid", clientSecret: "sec" });

      const result: any = await UmbracoManagementClient(
        { method: "delete", url: "/umbraco/management/api/v1/data-type/folder/x" },
        { returnFullResponse: true }
      );

      expect(typeof result.data).toBe("object");
      expect(result.data).toEqual(problemBody);
    });
  });

  describe("createUmbracoFetchClient (instance)", () => {
    it("parses application/problem+json error bodies as objects", async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          response(404, problemBody, "application/problem+json")
        );

      const { initialize, mutator } = createUmbracoFetchClient();
      initialize({ baseUrl: "https://example.com", clientId: "cid", clientSecret: "sec" });

      const result: any = await mutator(
        { method: "delete", url: "/umbraco/management/api/v1/data-type/folder/x" },
        { returnFullResponse: true }
      );

      expect(typeof result.data).toBe("object");
      expect(result.data).toEqual(problemBody);
    });

    it("still treats non-JSON bodies (text/plain) as strings", async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(response(200, "OK", "text/plain"));

      const { initialize, mutator } = createUmbracoFetchClient();
      initialize({ baseUrl: "https://example.com", clientId: "cid", clientSecret: "sec" });

      const result: any = await mutator(
        { method: "get", url: "/umbraco/management/api/v1/item" },
        { returnFullResponse: true }
      );

      expect(result.data).toBe("OK");
    });
  });
});
