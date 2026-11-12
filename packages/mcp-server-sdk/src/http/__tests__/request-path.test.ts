import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  assertSafeRequestPath,
  initializeUmbracoFetch,
  UmbracoManagementClient,
  createUmbracoFetchClient,
} from "../umbraco-fetch-client.js";
import { ToolValidationError } from "../../helpers/tool-validation-error.js";

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "t", expires_in: 3600 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

// Issue #447: tool inputs are only checked for control characters, so the
// URL-shaped checks live where a value actually becomes part of a URL path.
describe("assertSafeRequestPath", () => {
  const base = "/umbraco/management/api/v1";

  it.each([
    `${base}/document/550e8400-e29b-41d4-a716-446655440000`,
    `${base}/script//scripts/app.js`,
    `${base}/script/%2Fscripts%2Fapp.js/rename`,
    `${base}/health-check-group/Q&A`,
    `${base}/document/a..b`,
    `${base}/document/./x`,
  ])("accepts %s", (path) => {
    expect(() => assertSafeRequestPath(path)).not.toThrow();
  });

  it.each([
    `${base}/document/abc?skip=0`,
    `${base}/document/abc#x`,
    `${base}/document/../user/x`,
    `${base}/document/..`,
    `${base}/document/%2e%2e/user`,
    `${base}/document/.%2E/user`,
    `${base}/document/..\\user`,
    `${base}/script/a\\..\\b`,
  ])("rejects %s", (path) => {
    expect(() => assertSafeRequestPath(path)).toThrow(ToolValidationError);
  });

  it("names the path in the error so the agent can correct its arguments", () => {
    expect(() => assertSafeRequestPath(`${base}/document/abc?x=1`)).toThrow(/document\/abc\?x=1.*'\?' or '#'/);
  });
});

describe("request path check in the fetch clients", () => {
  it("singleton client rejects before fetching a token or calling Umbraco", async () => {
    initializeUmbracoFetch({ baseUrl: "https://localhost:44391", clientId: "cid", clientSecret: "sec" });

    await expect(
      UmbracoManagementClient({ method: "get", url: "/umbraco/management/api/v1/document/../user" })
    ).rejects.toBeInstanceOf(ToolValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("factory client rejects before fetching a token or calling Umbraco", async () => {
    const { initialize, mutator } = createUmbracoFetchClient();
    initialize({ baseUrl: "https://localhost:44391", clientId: "cid", clientSecret: "sec" });

    await expect(
      mutator({ method: "get", url: "/umbraco/management/api/v1/document/x?y=1" })
    ).rejects.toBeInstanceOf(ToolValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still sends query values with '?', '&' and '%' safely through params", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    const { initialize, mutator } = createUmbracoFetchClient();
    initialize({ baseUrl: "https://localhost:44391", clientId: "cid", clientSecret: "sec" });

    await mutator({ method: "get", url: "/umbraco/management/api/v1/item/document/search", params: { query: "Q&A? 50%" } });

    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://localhost:44391/umbraco/management/api/v1/item/document/search?query=Q%26A%3F%2050%25"
    );
  });
});
