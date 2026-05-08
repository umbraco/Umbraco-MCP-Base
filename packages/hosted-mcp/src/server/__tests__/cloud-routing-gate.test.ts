/**
 * Tests the env-driven gate (`UMBRACO_CLOUD_ROUTING_ENABLED`) added in
 * `createWorkerExport` (gate 2) and `createDefaultHandler` (gate 1).
 *
 * Three real flag/wiring combinations exercised here:
 * - `siteRouting` absent — single-tenant path, flag ignored
 * - `siteRouting` present + flag off — must behave like single-tenant
 * - `siteRouting` present + flag on — current PR #88 behaviour
 */

import { describe, expect, it, jest } from "@jest/globals";
import {
  createDefaultHandler,
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
  };
}

type WorkerFetch = (req: Request, env: HostedMcpEnv, ctx: ExecutionContext) => Promise<Response>;
type DefaultFetch = (req: Request, env: HostedMcpEnv) => Promise<Response>;

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

describe("createWorkerExport — UMBRACO_CLOUD_ROUTING_ENABLED gate (gate 2)", () => {
  describe("siteRouting wired + flag on", () => {
    it("renders the site-routing landing page on GET /", async () => {
      const oauthProvider = makeOauthProvider();
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv({ UMBRACO_CLOUD_ROUTING_ENABLED: "true" });
      const response = await handler.fetch(
        new Request("https://worker.example.com/"),
        env,
        {} as ExecutionContext,
      );

      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("Per-project URLs");
      expect(oauthProvider.fetch).not.toHaveBeenCalled();
    });

    it("routes /at/{alias} requests through siteRouter (resolveSite invoked)", async () => {
      const oauthProvider = makeOauthProvider();
      const siteRouting = makeSiteRouting();
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting,
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv({ UMBRACO_CLOUD_ROUTING_ENABLED: "true" });
      await handler.fetch(
        new Request("https://worker.example.com/at/abc/"),
        env,
        {} as ExecutionContext,
      );

      expect(siteRouting.resolveSite).toHaveBeenCalledWith("abc", env);
    });

    it("renders per-site protected-resource metadata for /.well-known/.../at/{alias}", async () => {
      const oauthProvider = makeOauthProvider();
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv({ UMBRACO_CLOUD_ROUTING_ENABLED: "true" });
      const response = await handler.fetch(
        new Request("https://worker.example.com/.well-known/oauth-protected-resource/at/abc"),
        env,
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { resource: string };
      expect(body.resource).toBe("https://worker.example.com/at/abc");
      expect(oauthProvider.fetch).not.toHaveBeenCalled();
    });
  });

  describe("siteRouting wired + flag off", () => {
    it("renders the single-tenant landing page on GET /", async () => {
      const oauthProvider = makeOauthProvider();
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv();
      const response = await handler.fetch(
        new Request("https://worker.example.com/"),
        env,
        {} as ExecutionContext,
      );

      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("https://single.example.com");
      expect(body).not.toContain("Per-project URLs");
    });

    it("falls /at/{alias} through to OAuthProvider unchanged (no resolveSite)", async () => {
      const oauthProvider = makeOauthProvider(async () => new Response("oauth-401", { status: 401 }));
      const siteRouting = makeSiteRouting();
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting,
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv();
      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/"),
        env,
        {} as ExecutionContext,
      );

      expect(siteRouting.resolveSite).not.toHaveBeenCalled();
      expect(oauthProvider.fetch).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(401);
    });

    it("does not render protected-resource metadata for /at/{alias} (falls through)", async () => {
      const oauthProvider = makeOauthProvider(async () => new Response("oauth-fallthrough", { status: 404 }));
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv();
      await handler.fetch(
        new Request("https://worker.example.com/.well-known/oauth-protected-resource/at/abc"),
        env,
        {} as ExecutionContext,
      );

      expect(oauthProvider.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("siteRouting absent (flag ignored)", () => {
    it("flag=on still serves the single-tenant landing page", async () => {
      const oauthProvider = makeOauthProvider();
      const handler = createWorkerExport(
        oauthProvider,
        baseOptions,
      ) as unknown as { fetch: WorkerFetch };

      const env = makeEnv({ UMBRACO_CLOUD_ROUTING_ENABLED: "true" });
      const response = await handler.fetch(
        new Request("https://worker.example.com/"),
        env,
        {} as ExecutionContext,
      );

      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("https://single.example.com");
      expect(body).not.toContain("Per-project URLs");
    });
  });
});

describe("createDefaultHandler — UMBRACO_CLOUD_ROUTING_ENABLED gate (gate 1)", () => {
  it("flag off + siteRouting wired: /callback/{siteId} returns 404 (single-tenant routing)", async () => {
    // handleSingleSiteRequest only matches `path === "/callback"`.
    // handleSiteRoutingRequest matches `/callback/:siteId`.
    // With the flag off, gate 1 must select single-tenant routing — so the
    // path falls through to 404 instead of being handled.
    const handler = createDefaultHandler({
      ...baseOptions,
      siteRouting: makeSiteRouting(),
    }) as unknown as { fetch: DefaultFetch };

    const response = await handler.fetch(
      new Request("https://worker.example.com/callback/abc"),
      makeEnv(),
    );

    expect(response.status).toBe(404);
  });

  it("flag off + siteRouting wired: /info renders single-tenant info shape", async () => {
    const handler = createDefaultHandler({
      ...baseOptions,
      siteRouting: makeSiteRouting(),
    }) as unknown as { fetch: DefaultFetch };

    const response = await handler.fetch(
      new Request("https://worker.example.com/info"),
      makeEnv({ ENABLE_INFO_ENDPOINT: "true" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // single-tenant /info doesn't include `sites`
    expect(body).not.toHaveProperty("sites");
  });

  it("flag absent + siteRouting absent: /callback/{siteId} also 404s (today's behaviour)", async () => {
    const handler = createDefaultHandler(baseOptions) as unknown as {
      fetch: DefaultFetch;
    };

    const response = await handler.fetch(
      new Request("https://worker.example.com/callback/abc"),
      makeEnv(),
    );

    expect(response.status).toBe(404);
  });
});
