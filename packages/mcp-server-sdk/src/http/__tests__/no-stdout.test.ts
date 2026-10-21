import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createUmbracoFetchClient } from "../umbraco-fetch-client.js";

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  jest.restoreAllMocks();
});

// In a stdio MCP server stdout carries the protocol, so the fetch client must
// never write to it (regression for the leftover `[sdk-fetch]` debug logs).
describe("fetch client stdout hygiene", () => {
  it.each([false, true])(
    "does not write to stdout for a FormData request (enableLogging=%s)",
    async (enableLogging) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
      jest.spyOn(console, "error").mockImplementation(() => {});

      const { initialize, mutator } = createUmbracoFetchClient({ enableLogging });
      initialize({ baseUrl: "https://example.com", clientId: "cid", clientSecret: "sec" });

      const form = new FormData();
      form.append("file", new Blob(["hello"]), "a.txt");
      form.append("name", "a");

      await mutator({ method: "post", url: "/umbraco/management/api/v1/temporary-file", data: form });

      expect(logSpy).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    }
  );
});
