import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

const TLS_ENV = "NODE_TLS_REJECT_UNAUTHORIZED";
const saved = { tls: process.env[TLS_ENV], nodeEnv: process.env.NODE_ENV };

let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  delete process.env[TLS_ENV];
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  for (const [key, value] of [[TLS_ENV, saved.tls], ["NODE_ENV", saved.nodeEnv]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const loadClient = async () => {
  jest.resetModules();
  return import("../umbraco-fetch-client.js");
};

const config = (baseUrl: string) => ({ baseUrl, clientId: "client", clientSecret: "secret" });

describe("TLS certificate verification", () => {
  it("is not disabled just by importing the client", async () => {
    delete process.env.NODE_ENV;
    await loadClient();
    expect(process.env[TLS_ENV]).toBeUndefined();
  });

  it("is not disabled by initializing the client, local or remote", async () => {
    const mod = await loadClient();
    mod.initializeUmbracoFetch(config("https://localhost:44391"));
    mod.initializeUmbracoFetch(config("https://example.umbraco.io"));
    expect(process.env[TLS_ENV]).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(["https://localhost:44391", "https://127.0.0.1:44391", "https://[::1]:44391", "https://LOCALHOST:44391"])(
    "does not warn when NODE_TLS_REJECT_UNAUTHORIZED=0 is used for a local site (%s)",
    async (baseUrl) => {
      process.env[TLS_ENV] = "0";
      (await loadClient()).initializeUmbracoFetch(config(baseUrl));
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["https://example.umbraco.io", "https://localhost.example.com", "https://127.0.0.1.example.com"])(
    "refuses to start when NODE_TLS_REJECT_UNAUTHORIZED=0 is used for a non-local site (%s)",
    async (baseUrl) => {
      process.env[TLS_ENV] = "0";
      const mod = await loadClient();
      expect(() => mod.initializeUmbracoFetch(config(baseUrl))).toThrow("Refusing to start");
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("Refusing to start");
      expect(mod.isUmbracoFetchInitialized()).toBe(false);
    },
  );

  it("refuses for clients from createUmbracoFetchClient", async () => {
    process.env[TLS_ENV] = "0";
    const client = (await loadClient()).createUmbracoFetchClient();
    expect(() => client.initialize(config("https://example.umbraco.io"))).toThrow("Refusing to start");
    expect(client.isInitialized()).toBe(false);
  });

  it("refuses the build-time token request before sending the secret (npm run generate)", async () => {
    const mod = await loadClient();
    process.env[TLS_ENV] = "0";
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    try {
      await expect(mod.requestClientCredentialsToken(config("https://example.umbraco.io"))).rejects.toThrow(
        "Refusing to start",
      );
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
