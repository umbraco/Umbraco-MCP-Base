/**
 * Wires-it-all-together tests for the tenant-OAuth discovery surface in
 * createWorkerExport: tenant AS metadata, tenant PRM, root /register
 * disabled under siteRouting, and the /at/<alias>/mcp passthrough preserved.
 */

import { describe, it, expect, jest } from "@jest/globals";
import {
  createWorkerExport,
  type HostedMcpServerOptions,
} from "../worker-entry.js";
import type { HostedMcpEnv } from "../../types/env.js";
import type {
  SiteConfig,
  SiteRoutingConfig,
} from "../../types/multi-site.js";

const baseOptions: HostedMcpServerOptions = {
  name: "test-mcp",
  version: "0.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

const siteFixture: SiteConfig = {
  id: "abc",
  displayName: "abc",
  baseUrl: "https://abc.example.com",
  oauthClientId: "test-client",
};

function makeRouting(overrides: Partial<SiteRoutingConfig> = {}): SiteRoutingConfig {
  return {
    pathPrefix: "/at/:siteId",
    resolveSite: async (id: string) =>
      id === "abc" ? siteFixture : null,
    ...overrides,
  };
}

function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
}

function makeEnv(): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://single.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: makeKV() as unknown as HostedMcpEnv["OAUTH_KV"],
    MCP_AGENT: {} as HostedMcpEnv["MCP_AGENT"],
    OAUTH_PROVIDER: {} as HostedMcpEnv["OAUTH_PROVIDER"],
  };
}

const ctx = {} as ExecutionContext;

describe("createWorkerExport — tenant-OAuth dispatch", () => {
  it("serves tenant AS metadata at /.well-known/oauth-authorization-server/at/<alias>", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/.well-known/oauth-authorization-server/at/abc"),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://worker.example.com/at/abc");
    expect(body.authorization_endpoint).toBe(
      "https://worker.example.com/at/abc/authorize"
    );
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("serves the same tenant AS metadata at the /mcp-suffixed path Copilot Studio probes (issue #308)", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/.well-known/oauth-authorization-server/at/abc/mcp"),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://worker.example.com/at/abc");
    expect(body.registration_endpoint).toBe("https://worker.example.com/at/abc/register");
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("serves the tenant PRM at the /mcp-suffixed RFC 9728 path (issue #308)", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/.well-known/oauth-protected-resource/at/abc/mcp"),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // RFC 9728 §3.3: `resource` is the URL the metadata was requested for.
    expect(body.resource).toBe("https://worker.example.com/at/abc/mcp");
    expect(body.authorization_servers).toEqual(["https://worker.example.com/at/abc"]);
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("serves tenant PRM at /.well-known/oauth-protected-resource/at/<alias> with tenant-pinned authorization_servers", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/.well-known/oauth-protected-resource/at/abc"),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.resource).toBe("https://worker.example.com/at/abc");
    expect(body.authorization_servers).toEqual(["https://worker.example.com/at/abc"]);
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("returns 404 root /register when siteRouting gate is on", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/register", { method: "POST" }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("registration_disabled");
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("DOES NOT 404 root /register when siteRouting gate returns false", async () => {
    const oauth = {
      fetch: jest.fn(async () => new Response("ok", { status: 200 })),
    };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting({ enabled: () => false }),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/register", { method: "POST" }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    expect(oauth.fetch).toHaveBeenCalled();
  });

  it("DOES NOT 404 root /register when siteRouting is undefined", async () => {
    const oauth = {
      fetch: jest.fn(async () => new Response("ok", { status: 200 })),
    };
    const handler = createWorkerExport(oauth as never, baseOptions);
    const response = await handler.fetch(
      new Request("https://worker.example.com/register", { method: "POST" }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
  });

  it("returns 404 root /.well-known/oauth-authorization-server when siteRouting gate is on", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request(
        "https://worker.example.com/.well-known/oauth-authorization-server",
        { method: "GET" },
      ),
      makeEnv(),
      ctx,
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_supported");
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("DOES NOT 404 root /.well-known/oauth-authorization-server when siteRouting gate returns false", async () => {
    const oauth = {
      fetch: jest.fn(async () => new Response("ok", { status: 200 })),
    };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting({ enabled: () => false }),
    });
    const response = await handler.fetch(
      new Request(
        "https://worker.example.com/.well-known/oauth-authorization-server",
        { method: "GET" },
      ),
      makeEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(oauth.fetch).toHaveBeenCalled();
  });

  it("DOES NOT 404 root /.well-known/oauth-authorization-server when siteRouting is undefined", async () => {
    const oauth = {
      fetch: jest.fn(async () => new Response("ok", { status: 200 })),
    };
    const handler = createWorkerExport(oauth as never, baseOptions);
    const response = await handler.fetch(
      new Request(
        "https://worker.example.com/.well-known/oauth-authorization-server",
        { method: "GET" },
      ),
      makeEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
  });

  it("/at/<alias>/mcp continues to flow through siteRouter to OAuthProvider unchanged", async () => {
    const oauth = {
      fetch: jest.fn(async (req: Request) => {
        expect(new URL(req.url).pathname).toBe("/at/abc/mcp");
        return new Response("oauth", { status: 200 });
      }),
    };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/at/abc/mcp", {
        method: "POST",
        headers: { authorization: "Bearer token" },
      }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    expect(oauth.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for tenant AS metadata when alias is unknown", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/.well-known/oauth-authorization-server/at/unknown"),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(404);
  });
});

describe("createWorkerExport — single-site OAuth endpoints", () => {
  function singleSite(oauth: { fetch: jest.Mock }) {
    return createWorkerExport(oauth as never, baseOptions);
  }

  function okProvider() {
    return { fetch: jest.fn(async (_request: Request) => new Response("ok")) };
  }

  it("drops a same-origin resource from a /token request so the grant's own applies", async () => {
    const oauth = okProvider();
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: "abc",
      client_id: "client-1",
      resource: "https://worker.example.com/mcp",
    });

    await singleSite(oauth as never).fetch(
      new Request("https://worker.example.com/token", {
        method: "POST",
        body: form.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      makeEnv(),
      ctx
    );

    const forwarded = oauth.fetch.mock.calls[0][0];
    const sent = new URLSearchParams(await forwarded.text());
    expect(new URL(forwarded.url).pathname).toBe("/token");
    expect(sent.has("resource")).toBe(false);
    expect(sent.get("code")).toBe("abc");
  });

  it("leaves a tenant /token request to the tenant router under site routing", async () => {
    const oauth = okProvider();
    const handler = createWorkerExport(oauth as never, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "client-1",
      resource: "https://worker.example.com/at/abc",
    });

    await handler.fetch(
      new Request("https://worker.example.com/token", {
        method: "POST",
        body: form.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      makeEnv(),
      ctx
    );

    const sent = new URLSearchParams(await oauth.fetch.mock.calls[0][0].text());
    expect(sent.get("resource")).toBe("https://worker.example.com/at/abc");
  });

  it("refuses an oversized registration at root /register", async () => {
    const oauth = okProvider();

    const response = await singleSite(oauth as never).fetch(
      new Request("https://worker.example.com/register", {
        method: "POST",
        body: JSON.stringify({ client_name: "x".repeat(20_000) }),
        headers: { "content-type": "application/json" },
      }),
      makeEnv(),
      ctx
    );

    expect(response.status).toBe(413);
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("passes an ordinary registration through to the provider", async () => {
    const oauth = okProvider();

    const response = await singleSite(oauth as never).fetch(
      new Request("https://worker.example.com/register", {
        method: "POST",
        body: JSON.stringify({ client_name: "Test client", redirect_uris: ["http://127.0.0.1/cb"] }),
        headers: { "content-type": "application/json" },
      }),
      makeEnv(),
      ctx
    );

    expect(response.status).toBe(200);
    expect(oauth.fetch).toHaveBeenCalledTimes(1);
  });
});
