/**
 * Tests the WWW-Authenticate `resource_metadata` rewrite that wraps
 * OAuthProvider's 401 responses for `/at/<alias>/...` paths.
 *
 * `@cloudflare/workers-oauth-provider` builds the `resource_metadata` URL
 * from `url.origin` only (the root PRM), regardless of request path.
 * Without our wrapper, a client hitting `/at/<alias>/mcp` walks root
 * discovery and crashes at root `/register`. The wrapper rewrites
 * `resource_metadata="<origin>/.well-known/oauth-protected-resource"` to
 * `resource_metadata="<origin>/.well-known/oauth-protected-resource/at/<alias>"`
 * so the discovery walk lands on the tenant chain.
 *
 * Issue umbraco-mcp-base#103.
 */

import { describe, expect, it, jest } from "@jest/globals";
import { createWorkerExport, type HostedMcpServerOptions } from "../worker-entry.js";
import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";

const baseOptions: HostedMcpServerOptions = {
  name: "test-mcp",
  version: "0.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

const siteConfigFixture: SiteConfig = {
  id: "abc",
  displayName: "abc",
  baseUrl: "https://abc.example.com",
  oauthClientId: "test-client",
};

function makeSiteRouting(): SiteRoutingConfig & {
  resolveSite: jest.Mock<(siteId: string, env: HostedMcpEnv) => Promise<SiteConfig | null>>;
} {
  return {
    pathPrefix: "/at/:siteId",
    resolveSite: jest
      .fn<(siteId: string, env: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockResolvedValue(siteConfigFixture),
    enabled: () => true,
  };
}

type WorkerFetch = (req: Request, env: HostedMcpEnv, ctx: ExecutionContext) => Promise<Response>;

function makeOauthProvider(impl?: WorkerFetch) {
  return {
    fetch: jest.fn<WorkerFetch>(impl ?? (async () => new Response("oauth", { status: 200 }))),
  };
}

function makeEnv(overrides: Partial<HostedMcpEnv> = {}): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://single.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: {} as KVNamespace,
    MCP_AGENT: {} as DurableObjectNamespace,
    OAUTH_PROVIDER: {} as HostedMcpEnv["OAUTH_PROVIDER"],
    ...overrides,
  };
}

const ROOT_PRM = "https://worker.example.com/.well-known/oauth-protected-resource";
const TENANT_PRM = "https://worker.example.com/.well-known/oauth-protected-resource/at/abc";

/** Mimics OAuthProvider's 401 shape (verbatim from
 * `@cloudflare/workers-oauth-provider/dist/oauth-provider.js`). */
function oauth401Response(resourceMetadataUrl = ROOT_PRM): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_token",
      error_description: "Missing or invalid access token",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${resourceMetadataUrl}", error="invalid_token", error_description="Missing or invalid access token"`,
      },
    },
  );
}

describe("createWorkerExport — WWW-Authenticate rewrite for tenant paths (issue #103)", () => {
  describe("tenant-path 401s", () => {
    it("rewrites resource_metadata to the tenant PRM on /at/<alias>/mcp", async () => {
      const oauthProvider = makeOauthProvider(async () => oauth401Response());
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      expect(response.status).toBe(401);
      const auth = response.headers.get("www-authenticate") ?? "";
      expect(auth).toContain(`resource_metadata="${TENANT_PRM}"`);
      expect(auth).not.toContain(`resource_metadata="${ROOT_PRM}"`);
    });

    it("preserves the rest of the WWW-Authenticate header verbatim", async () => {
      const oauthProvider = makeOauthProvider(async () => oauth401Response());
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      const auth = response.headers.get("www-authenticate") ?? "";
      expect(auth).toMatch(/^Bearer realm="OAuth"/);
      expect(auth).toContain(`error="invalid_token"`);
      expect(auth).toContain(`error_description="Missing or invalid access token"`);
    });

    it("preserves the response body and status", async () => {
      const oauthProvider = makeOauthProvider(async () => oauth401Response());
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_token");
    });
  });

  describe("non-tenant 401s — no regression", () => {
    it("leaves the root resource_metadata URL untouched on /mcp (no /at prefix)", async () => {
      const oauthProvider = makeOauthProvider(async () => oauth401Response());
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      const auth = response.headers.get("www-authenticate") ?? "";
      expect(auth).toContain(`resource_metadata="${ROOT_PRM}"`);
      expect(auth).not.toContain("/at/");
    });

    it("leaves the root URL untouched when siteRouting is absent", async () => {
      const oauthProvider = makeOauthProvider(async () => oauth401Response());
      const handler = createWorkerExport(oauthProvider, baseOptions) as unknown as {
        fetch: WorkerFetch;
      };

      const response = await handler.fetch(
        new Request("https://worker.example.com/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      const auth = response.headers.get("www-authenticate") ?? "";
      expect(auth).toContain(`resource_metadata="${ROOT_PRM}"`);
    });
  });

  describe("edge cases", () => {
    it("does not modify non-401 responses", async () => {
      const oauthProvider = makeOauthProvider(
        async () => new Response("ok", { status: 200, headers: { "X-Stamp": "passthrough" } }),
      );
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-stamp")).toBe("passthrough");
    });

    it("passes through 401s that lack a WWW-Authenticate header", async () => {
      const oauthProvider = makeOauthProvider(
        async () => new Response(null, { status: 401 }),
      );
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      expect(response.status).toBe(401);
      expect(response.headers.has("www-authenticate")).toBe(false);
    });

    it("passes through 401s whose WWW-Authenticate has no root resource_metadata to swap", async () => {
      const oauthProvider = makeOauthProvider(
        async () =>
          new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer realm="OAuth", error="invalid_token"` },
          }),
      );
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/mcp", { method: "POST" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      const auth = response.headers.get("www-authenticate") ?? "";
      expect(auth).toBe(`Bearer realm="OAuth", error="invalid_token"`);
    });

    it("rewrites for nested paths under /at/<alias>/, not just /mcp", async () => {
      const oauthProvider = makeOauthProvider(async () => oauth401Response());
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/some/sub/path", { method: "GET" }),
        makeEnv(),
        {} as ExecutionContext,
      );

      const auth = response.headers.get("www-authenticate") ?? "";
      expect(auth).toContain(`resource_metadata="${TENANT_PRM}"`);
    });
  });
});
