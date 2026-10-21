import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  initializeUmbracoFetch,
  UmbracoManagementClient,
  createUmbracoFetchClient,
} from "../umbraco-fetch-client.js";

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;
const secretBody = { title: "Invalid", errors: { email: ["jane.doe@example.com is taken"] } };
const path = "/umbraco/management/api/v1/member";

let errorSpy: jest.SpiedFunction<typeof console.error>;

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function failure(): Response {
  return new Response(JSON.stringify(secretBody), {
    status: 400,
    headers: { "Content-Type": "application/problem+json" },
  });
}

const loggedText = () => JSON.stringify(errorSpy.mock.calls);

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  errorSpy.mockRestore();
  delete process.env.UMBRACO_MCP_LOG_ERROR_BODIES;
});

describe("failed request logging", () => {
  const auth = { baseUrl: "https://localhost:5201", clientId: "cid", clientSecret: "sec" };

  describe("singleton client", () => {
    it("logs status, method and path but not the body by default", async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failure());
      initializeUmbracoFetch(auth);

      await expect(
        UmbracoManagementClient({ method: "post", url: path, params: { q: "x" } })
      ).rejects.toMatchObject({ response: { status: 400, data: secretBody } });

      expect(loggedText()).toContain("400");
      expect(loggedText()).toContain("POST");
      expect(loggedText()).toContain(path);
      expect(loggedText()).not.toContain("jane.doe@example.com");
    });

    it("logs the body when UMBRACO_MCP_LOG_ERROR_BODIES=true", async () => {
      process.env.UMBRACO_MCP_LOG_ERROR_BODIES = "true";
      mockFetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failure());
      initializeUmbracoFetch(auth);

      await expect(UmbracoManagementClient({ method: "post", url: path })).rejects.toThrow();

      expect(loggedText()).toContain("jane.doe@example.com");
    });
  });

  describe("createUmbracoFetchClient", () => {
    it("does not log the body by default, and the thrown error is unchanged", async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failure());
      const { initialize, mutator } = createUmbracoFetchClient();
      initialize(auth);

      await expect(mutator({ method: "post", url: path })).rejects.toMatchObject({
        message: expect.stringContaining("400"),
        response: { status: 400, data: secretBody },
      });

      expect(loggedText()).toContain(path);
      expect(loggedText()).not.toContain("jane.doe@example.com");
    });

    it("logs the body when enableLogging is true", async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failure());
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const { initialize, mutator } = createUmbracoFetchClient({ enableLogging: true });
      initialize(auth);

      await expect(mutator({ method: "post", url: path })).rejects.toThrow();
      logSpy.mockRestore();

      expect(loggedText()).toContain("jane.doe@example.com");
    });
  });
});
