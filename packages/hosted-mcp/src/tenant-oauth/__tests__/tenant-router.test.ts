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

  it("advertises confidential and public token-endpoint auth methods (issue #308)", async () => {
    const response = renderTenantAuthorizationServerMetadata(
      "https://worker.example.com",
      "demo",
      new Request("https://worker.example.com/.well-known/oauth-authorization-server/at/demo")
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_endpoint_auth_methods_supported).toEqual([
      "none",
      "client_secret_basic",
      "client_secret_post",
    ]);
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
    ["/.well-known/oauth-authorization-server/at/demo/", "as-metadata", "demo"],
    // Copilot Studio inserts the well-known segment using the MCP URL path
    // (issue #308) — the `/mcp` suffix must resolve to the same tenant doc.
    ["/.well-known/oauth-authorization-server/at/demo/mcp", "as-metadata", "demo"],
    ["/.well-known/oauth-authorization-server/at/demo/mcp/", "as-metadata", "demo"],
    ["/.well-known/oauth-protected-resource/at/demo", "prm", "demo"],
    ["/.well-known/oauth-protected-resource/at/demo/", "prm", "demo"],
    ["/.well-known/oauth-protected-resource/at/demo/mcp", "prm", "demo"],
    ["/.well-known/oauth-protected-resource/at/demo/mcp/", "prm", "demo"],
    // Region-qualified Cloud aliases contain a dot.
    ["/.well-known/oauth-authorization-server/at/demo.uksouth01/mcp", "as-metadata", "demo.uksouth01"],
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
    // Only `/mcp` is an accepted suffix — anything else after the alias is not
    // a tenant well-known document.
    "/.well-known/oauth-authorization-server/at/demo/mcpx",
    "/.well-known/oauth-authorization-server/at/demo/mcp/extra",
    "/.well-known/oauth-authorization-server/at/demo/other",
    "/.well-known/oauth-protected-resource/at/demo/other",
    // Path-after form with the MCP suffix is not served (Copilot Studio only
    // probes it for openid-configuration, which OAuthProvider owns).
    "/at/demo/mcp/.well-known/oauth-authorization-server",
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

  it("rejects 400 invalid_request when sent resource is not a canonical spelling", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo%2Fother"
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

  it("accepts the MCP endpoint URL as resource and forwards the bare canonical value (issue #308)", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn(async () => new Response("ok", { status: 200 }));
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request(
        "https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo%2Fmcp"
      ),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    expect(response.status).toBe(200);
    expect(oauthFetch).toHaveBeenCalledTimes(1);
    const forwarded = (oauthFetch.mock.calls[0] as unknown as [Request])[0];
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.pathname).toBe("/authorize");
    // The accepted spelling must never leak into the audience — only the
    // bare canonical value reaches OAuthProvider.
    expect(forwardedUrl.searchParams.getAll("resource")).toEqual([
      "https://worker.example.com/at/demo",
    ]);
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

describe("dispatchTenantOAuth — token client identity", () => {
  function tokenRequest(options: {
    query?: string;
    form?: Record<string, string>;
    headers?: Record<string, string>;
  }): Request {
    const form = new URLSearchParams({ grant_type: "refresh_token", ...(options.form ?? {}) });
    return new Request(`https://worker.example.com/at/demo/token${options.query ?? ""}`, {
      method: "POST",
      body: form.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(options.headers ?? {}),
      },
    });
  }

  const basic = (id: string, secret: string) => `Basic ${btoa(`${id}:${secret}`)}`;

  it("accepts a client that authenticates with HTTP Basic", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn(async () => new Response("ok"));

    const response = await dispatchTenantOAuth(
      { kind: "token", alias: "demo" },
      tokenRequest({ headers: { Authorization: basic("client-1", "s3cret") } }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(200);
    expect(oauthFetch).toHaveBeenCalledTimes(1);
  });

  it("checks the Basic client, not a client_id in the query string", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    await putClientBinding(kv as never, "other-tenant", "client-2");
    const oauthFetch = jest.fn();

    const response = await dispatchTenantOAuth(
      { kind: "token", alias: "demo" },
      tokenRequest({
        query: "?client_id=client-1",
        headers: { Authorization: basic("client-2", "s3cret") },
      }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_client");
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("checks the form client, not a client_id in the query string", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    await putClientBinding(kv as never, "other-tenant", "client-2");
    const oauthFetch = jest.fn();

    const response = await dispatchTenantOAuth(
      { kind: "token", alias: "demo" },
      tokenRequest({ query: "?client_id=client-1", form: { client_id: "client-2" } }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(400);
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("requires a client id in the request itself, never only in the query string", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    const oauthFetch = jest.fn();

    const response = await dispatchTenantOAuth(
      { kind: "token", alias: "demo" },
      tokenRequest({ query: "?client_id=client-1" }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_request");
    expect(oauthFetch).not.toHaveBeenCalled();
  });
});

describe("dispatchTenantOAuth — authorize client identity", () => {
  it("checks the query-string client on a consent submission, not one in the form", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as never, "demo", "client-1");
    await putClientBinding(kv as never, "other-tenant", "client-2");
    const oauthFetch = jest.fn();

    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request("https://worker.example.com/at/demo/authorize?client_id=client-2", {
        method: "POST",
        body: new URLSearchParams({ client_id: "client-1", action: "approve" }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_client");
    expect(oauthFetch).not.toHaveBeenCalled();
  });
});

describe("dispatchTenantOAuth — protected resource metadata", () => {
  async function prm(path: string): Promise<Record<string, unknown>> {
    const match = matchTenantOAuthPath(path)!;
    const response = await dispatchTenantOAuth(
      match,
      new Request(`https://worker.example.com${path}`),
      makeEnv(createMockKV()),
      ctx,
      makeRouting(),
      { fetch: jest.fn() as never }
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  it("names the tenant as the resource for the tenant metadata URL", async () => {
    const body = await prm("/.well-known/oauth-protected-resource/at/demo");
    expect(body.resource).toBe("https://worker.example.com/at/demo");
    expect(body.authorization_servers).toEqual(["https://worker.example.com/at/demo"]);
  });

  it("names the MCP endpoint as the resource for the MCP endpoint's metadata URL", async () => {
    const body = await prm("/.well-known/oauth-protected-resource/at/demo/mcp");
    expect(body.resource).toBe("https://worker.example.com/at/demo/mcp");
    expect(body.authorization_servers).toEqual(["https://worker.example.com/at/demo"]);
  });
});

describe("dispatchTenantOAuth — registration limits", () => {
  function registerRequest(body: string, headers: Record<string, string> = {}): Request {
    return new Request("https://worker.example.com/at/demo/register", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  it("refuses an oversized registration before it reaches the provider", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn();

    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "demo" },
      registerRequest(JSON.stringify({ client_name: "x".repeat(20_000) })),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(413);
    expect(oauthFetch).not.toHaveBeenCalled();
    expect(kv.store.size).toBe(0);
  });

  it("refuses a registration over the rate limit, keyed by caller address", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn();
    const limit = jest.fn(async (_options: { key: string }) => ({ success: false }));

    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "demo" },
      registerRequest("{}", { "cf-connecting-ip": "203.0.113.7" }),
      { ...makeEnv(kv), REGISTER_RATE_LIMITER: { limit } },
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("still registers when the rate limiter itself fails", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn(
      async () => new Response(JSON.stringify({ client_id: "client-9" }), { status: 201 })
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const limit = jest.fn(async () => {
      throw new Error("limiter down");
    });

    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "demo" },
      registerRequest("{}"),
      { ...makeEnv(kv), REGISTER_RATE_LIMITER: { limit } },
      ctx,
      makeRouting(),
      { fetch: oauthFetch as never }
    );
    warn.mockRestore();

    expect(response.status).toBe(201);
    expect(kv.store.get("client:client-9:tenant")).toBe("demo");
  });
});
