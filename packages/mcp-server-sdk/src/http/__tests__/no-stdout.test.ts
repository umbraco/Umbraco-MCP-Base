import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createUmbracoFetchClient } from "../umbraco-fetch-client.js";

// Regression for #416: in a stdio MCP server stdout carries the protocol, so
// the fetch client must never write to it (console.log / process.stdout).
const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(enableLogging: boolean) {
  const client = createUmbracoFetchClient({ enableLogging });
  client.initialize({ baseUrl: "https://localhost:44391", clientId: "cid", clientSecret: "sec" });
  return client;
}

describe("fetch client stdout hygiene", () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input) =>
      String(input).includes("/token")
        ? jsonResponse({ access_token: "t", expires_in: 3600 })
        : jsonResponse({ ok: true })
    );
    (globalThis as any).fetch = mockFetch;
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  const expectNoStdout = () => {
    expect(logSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  };

  it("writes nothing to stdout for a JSON request", async () => {
    await makeClient(false).mutator({ method: "post", url: "/x", data: { a: 1 } });
    expectNoStdout();
  });

  it("writes nothing to stdout for a Web FormData request", async () => {
    const fd = new FormData();
    fd.append("name", "value");
    fd.append("file", new Blob(["abc"]), "a.txt");
    await makeClient(false).mutator({ method: "post", url: "/upload", data: fd });
    expectNoStdout();
  });

  it("sends enableLogging output to stderr, not stdout", async () => {
    await makeClient(true).mutator({ method: "get", url: "/logged" });
    expectNoStdout();
    const lines = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual(expect.arrayContaining(["Request:", "Response:"]));
  });
});
