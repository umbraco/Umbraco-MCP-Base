import { describe, it, expect, jest } from "@jest/globals";
import {
  renderTenantAuthorizationServerMetadata,
  matchTenantOAuthPath,
  dispatchTenantOAuth,
} from "../tenant-router.js";
import { putClientBinding } from "../binding-store.js";
import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";

describe("renderTenantAuthorizationServerMetadata", () => {
  it("returns RFC 8414 metadata with tenant-prefixed endpoints", async () => {
    const request = new Request(
      "https://worker.example.com/.well-known/oauth-authorization-server/at/demo"
    );
    const response = renderTenantAuthorizationServerMetadata(
      "https://worker.example.com",
      "demo",
      request
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://worker.example.com/at/demo");
    expect(body.authorization_endpoint).toBe(
      "https://worker.example.com/at/demo/authorize"
    );
    expect(body.token_endpoint).toBe("https://worker.example.com/at/demo/token");
    expect(body.registration_endpoint).toBe(
      "https://worker.example.com/at/demo/register"
    );
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.code_challenge_methods_supported).toContain("S256");
  });

  it("returns CORS-safe headers", () => {
    const request = new Request(
      "https://worker.example.com/.well-known/oauth-authorization-server/at/demo"
    );
    const response = renderTenantAuthorizationServerMetadata(
      "https://worker.example.com",
      "demo",
      request
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("returns 204 + CORS preflight on OPTIONS", () => {
    const request = new Request(
      "https://worker.example.com/.well-known/oauth-authorization-server/at/demo",
      { method: "OPTIONS" }
    );
    const response = renderTenantAuthorizationServerMetadata(
      "https://worker.example.com",
      "demo",
      request
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
  });
});

describe("matchTenantOAuthPath", () => {
  it.each([
    ["/at/demo/authorize", "authorize", "demo"],
    ["/at/demo/token", "token", "demo"],
    ["/at/demo/register", "register", "demo"],
    ["/at/demo/callback", "callback", "demo"],
    ["/at/demo/.well-known/oauth-authorization-server", "as-metadata", "demo"],
    ["/.well-known/oauth-authorization-server/at/demo", "as-metadata", "demo"],
    ["/.well-known/oauth-protected-resource/at/demo", "prm", "demo"],
  ])("matches %s as kind=%s alias=%s", (path, kind, alias) => {
    const match = matchTenantOAuthPath(path);
    expect(match).not.toBeNull();
    expect(match!.kind).toBe(kind);
    expect(match!.alias).toBe(alias);
  });

  it.each([
    "/at/demo/mcp",
    "/mcp",
    "/authorize",
    "/at/",
    "/at/demo",
    "/random/path",
  ])("does not match %s", (path) => {
    expect(matchTenantOAuthPath(path)).toBeNull();
  });

  it("preserves trailing slashes (matches /at/demo/authorize/)", () => {
    expect(matchTenantOAuthPath("/at/demo/authorize/")).toEqual({
      kind: "authorize",
      alias: "demo",
    });
  });
});

const siteFixture: SiteConfig = {
  id: "demo",
  displayName: "Demo",
  baseUrl: "https://demo.example.com",
  oauthClientId: "demo-client",
};

function createMockKV() {
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

function makeRouting(): SiteRoutingConfig {
  return {
    pathPrefix: "/at/:siteId",
    resolveSite: jest
      .fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockResolvedValue(siteFixture),
  };
}

function makeEnv(kv: ReturnType<typeof createMockKV>): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://demo.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: kv as unknown as HostedMcpEnv["OAUTH_KV"],
    MCP_AGENT: {} as HostedMcpEnv["MCP_AGENT"],
    OAUTH_PROVIDER: {} as HostedMcpEnv["OAUTH_PROVIDER"],
  };
}

const ctx = {} as ExecutionContext;

describe("dispatchTenantOAuth — register", () => {
  it("forwards to /register and writes bindings on success", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn(async (req: Request) => {
      expect(new URL(req.url).pathname).toBe("/register");
      return new Response(
        JSON.stringify({ client_id: "issued-client-1", client_secret: null }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    });

    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "demo" },
      new Request("https://worker.example.com/at/demo/register", {
        method: "POST",
        body: JSON.stringify({
          redirect_uris: ["https://worker.example.com/at/demo/callback"],
        }),
        headers: { "content-type": "application/json" },
      }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(201);
    expect(kv.store.has("at:demo:client:issued-client-1")).toBe(true);
    expect(kv.store.get("client:issued-client-1:tenant")).toBe("demo");
  });

  it("does NOT write bindings when OAuthProvider rejects the registration", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_client_metadata" }), {
          status: 400,
        })
    );
    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "demo" },
      new Request("https://worker.example.com/at/demo/register", { method: "POST" }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(400);
    expect(kv.store.size).toBe(0);
  });

  it("returns 404 when alias is unknown", async () => {
    const kv = createMockKV();
    const routing: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: async () => null,
    };
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "missing" },
      new Request("https://worker.example.com/at/missing/register", { method: "POST" }),
      makeEnv(kv),
      ctx,
      routing,
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(404);
    expect(oauthFetch).not.toHaveBeenCalled();
  });
});

describe("dispatchTenantOAuth — authorize", () => {
  it("rejects 400 invalid_client when no binding exists", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=unbound-client&response_type=code"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_client");
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("rejects when binding exists for a different tenant", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "other-tenant", "client-1");
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(400);
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("forwards with stripped path and synthesised resource when binding matches", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn(async (req: Request) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/authorize");
      expect(u.searchParams.get("resource")).toBe("https://worker.example.com/at/demo");
      expect(u.searchParams.get("client_id")).toBe("client-1");
      expect(u.searchParams.get("redirect_uri")).toBe(
        "https://worker.example.com/at/demo/callback"
      );
      return new Response("ok", { status: 200 });
    });

    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&redirect_uri=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo%2Fcallback"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(200);
    expect(oauthFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects 400 invalid_request when sent resource does not byte-equal canonical", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo%2F"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("forwards unchanged when sent resource matches canonical exactly", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn(async (req: Request) => {
      const u = new URL(req.url);
      expect(u.searchParams.get("resource")).toBe("https://worker.example.com/at/demo");
      return new Response("ok", { status: 200 });
    });

    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(200);
  });

  it("rejects multi-valued resource (resource=A&resource=B) even when one element is canonical", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fother"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("forces resource to canonical when forwarding (overrides client-supplied value even if it would have validated)", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn(async (req: Request) => {
      const u = new URL(req.url);
      // Exactly one resource value, exactly the canonical — even if the
      // request had carried something else that validated, the forwarded
      // request must only contain canonical.
      expect(u.searchParams.getAll("resource")).toEqual([
        "https://worker.example.com/at/demo",
      ]);
      return new Response("ok", { status: 200 });
    });

    // Caller sends single canonical (passes validator). The dispatcher should
    // still re-emit only canonical to OAuthProvider, not preserve the client's
    // raw param verbatim.
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(200);
  });

  it("rejects multi-valued resource on POST form body (token endpoint)", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn();
    const formBody = new URLSearchParams();
    formBody.append("client_id", "client-1");
    formBody.append("grant_type", "authorization_code");
    formBody.append("code", "abc");
    formBody.append("resource", "https://worker.example.com/at/demo");
    formBody.append("resource", "https://worker.example.com/at/other");

    const response = await dispatchTenantOAuth(
      { kind: "token", alias: "demo" },
      new Request("https://worker.example.com/at/demo/token", {
        method: "POST",
        body: formBody.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(400);
    expect(oauthFetch).not.toHaveBeenCalled();
  });
});
