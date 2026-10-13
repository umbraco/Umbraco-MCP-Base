import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

const TLS_ENV = "NODE_TLS_REJECT_UNAUTHORIZED";
const OPT_IN_ENV = "UMBRACO_ALLOW_SELF_SIGNED_LOCALHOST";
const saved = { tls: process.env[TLS_ENV], optIn: process.env[OPT_IN_ENV], nodeEnv: process.env.NODE_ENV };

let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  delete process.env[TLS_ENV];
  delete process.env[OPT_IN_ENV];
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  for (const [key, value] of [[TLS_ENV, saved.tls], [OPT_IN_ENV, saved.optIn], ["NODE_ENV", saved.nodeEnv]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const loadClient = async () => {
  jest.resetModules();
  return import("../umbraco-fetch-client.js");
};

const init = (mod: Awaited<ReturnType<typeof loadClient>>, baseUrl: string) =>
  mod.initializeUmbracoFetch({ baseUrl, clientId: "client", clientSecret: "secret" });

describe("TLS certificate verification", () => {
  it("is not disabled just by importing the client", async () => {
    delete process.env.NODE_ENV;
    await loadClient();
    expect(process.env[TLS_ENV]).toBeUndefined();
  });

  it("stays on for a remote site with no opt-in", async () => {
    init(await loadClient(), "https://example.umbraco.io");
    expect(process.env[TLS_ENV]).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("stays on for a local site without the opt-in", async () => {
    init(await loadClient(), "https://localhost:44391");
    expect(process.env[TLS_ENV]).toBeUndefined();
  });

  it.each(["https://localhost:44391", "https://127.0.0.1:44391", "https://[::1]:44391", "https://LOCALHOST:44391"])(
    "is disabled for a local site when opted in (%s)",
    async (baseUrl) => {
      process.env[OPT_IN_ENV] = "true";
      init(await loadClient(), baseUrl);
      expect(process.env[TLS_ENV]).toBe("0");
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("disabled for this process");
    },
  );

  it.each(["https://example.umbraco.io", "https://localhost.example.com", "https://127.0.0.1.example.com"])(
    "ignores the opt-in for a non-local site (%s)",
    async (baseUrl) => {
      process.env[OPT_IN_ENV] = "true";
      init(await loadClient(), baseUrl);
      expect(process.env[TLS_ENV]).toBeUndefined();
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("is ignored");
    },
  );

  it("warns when the user disabled verification for a non-local site", async () => {
    process.env[TLS_ENV] = "0";
    init(await loadClient(), "https://example.umbraco.io");
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("not being verified");
  });

  it("applies the same policy to clients from createUmbracoFetchClient", async () => {
    const mod = await loadClient();
    process.env[OPT_IN_ENV] = "true";
    mod.createUmbracoFetchClient().initialize({ baseUrl: "https://example.umbraco.io", clientId: "client", clientSecret: "secret" });
    expect(process.env[TLS_ENV]).toBeUndefined();
    mod.createUmbracoFetchClient().initialize({ baseUrl: "https://localhost:44391", clientId: "client", clientSecret: "secret" });
    expect(process.env[TLS_ENV]).toBe("0");
  });

  it("applies the policy to the build-time token request too (npm run generate)", async () => {
    const mod = await loadClient();
    process.env[OPT_IN_ENV] = "true";
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = jest.fn(async () =>
      new Response(JSON.stringify({ access_token: "t", expires_in: 60 }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    try {
      await mod.requestClientCredentialsToken({ baseUrl: "https://localhost:44391", clientId: "client", clientSecret: "secret" });
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
    expect(process.env[TLS_ENV]).toBe("0");
  });

  it("prints each policy message once per process", async () => {
    const mod = await loadClient();
    process.env[TLS_ENV] = "0";
    init(mod, "https://example.umbraco.io");
    init(mod, "https://example.umbraco.io");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
