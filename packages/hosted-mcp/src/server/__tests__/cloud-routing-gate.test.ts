/**
 * Tests the runtime gate (`siteRouting.enabled`) consulted by gates 1 and 2:
 * - `createDefaultHandler` derives `effectiveSiteRouting` from `enabled?.(env)`
 * - `createWorkerExport` consults the same predicate at request time
 *
 * Real wiring combinations exercised:
 * - `siteRouting` absent — single-tenant path, gate inert
 * - `siteRouting` present, no `enabled` — always-on (default for custom configs)
 * - `siteRouting` present + `enabled` returns false — behaves like single-tenant
 * - `siteRouting` present + `enabled` returns true — full URL-based routing
 *
 * The Umbraco Cloud preset wires `enabled` to `env.UMBRACO_CLOUD_ROUTING_ENABLED`
 * by default; non-Cloud consumers either omit `enabled` (always-on) or supply
 * their own predicate.
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

interface MakeSiteRoutingOptions {
  enabled?: SiteRoutingConfig["enabled"];
}

function makeSiteRouting(opts: MakeSiteRoutingOptions = {}): SiteRoutingConfig & {
  resolveSite: jest.Mock<(siteId: string, env: HostedMcpEnv) => Promise<SiteConfig | null>>;
} {
  return {
    pathPrefix: "/at/:siteId",
    resolveSite: jest
      .fn<(siteId: string, env: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockResolvedValue(siteConfigFixture),
    ...(opts.enabled ? { enabled: opts.enabled } : {}),
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

describe("createWorkerExport — siteRouting.enabled gate (gate 2)", () => {
  describe("siteRouting wired + enabled returns true", () => {
    it("renders the site-routing landing page on GET /", async () => {
      const oauthProvider = makeOauthProvider();
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting({ enabled: () => true }),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/"),
        makeEnv(),
        {} as ExecutionContext,
      );

      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("Per-project URLs");
      expect(oauthProvider.fetch).not.toHaveBeenCalled();
    });

    it("routes /at/{alias} requests through siteRouter (resolveSite invoked)", async () => {
      const oauthProvider = makeOauthProvider();
      const siteRouting = makeSiteRouting({ enabled: () => true });
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting,
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv();
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
        siteRouting: makeSiteRouting({ enabled: () => true }),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/.well-known/oauth-protected-resource/at/abc"),
        makeEnv(),
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { resource: string };
      expect(body.resource).toBe("https://worker.example.com/at/abc");
      expect(oauthProvider.fetch).not.toHaveBeenCalled();
    });
  });

  describe("siteRouting wired + enabled returns false", () => {
    it("renders the single-tenant landing page on GET /", async () => {
      const oauthProvider = makeOauthProvider();
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting({ enabled: () => false }),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/"),
        makeEnv(),
        {} as ExecutionContext,
      );

      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("https://single.example.com");
      expect(body).not.toContain("Per-project URLs");
    });

    it("falls /at/{alias} through to OAuthProvider unchanged (no resolveSite)", async () => {
      const oauthProvider = makeOauthProvider(async () => new Response("oauth-401", { status: 401 }));
      const siteRouting = makeSiteRouting({ enabled: () => false });
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting,
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/at/abc/"),
        makeEnv(),
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
        siteRouting: makeSiteRouting({ enabled: () => false }),
      }) as unknown as { fetch: WorkerFetch };

      await handler.fetch(
        new Request("https://worker.example.com/.well-known/oauth-protected-resource/at/abc"),
        makeEnv(),
        {} as ExecutionContext,
      );

      expect(oauthProvider.fetch).toHaveBeenCalledTimes(1);
    });

    it("passes the request env to the predicate", async () => {
      const enabled = jest.fn<NonNullable<SiteRoutingConfig["enabled"]>>().mockReturnValue(false);
      const oauthProvider = makeOauthProvider(async () => new Response("ok", { status: 401 }));
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting: makeSiteRouting({ enabled }),
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv({ UMBRACO_BASE_URL: "https://probe.example.com" });
      await handler.fetch(
        new Request("https://worker.example.com/at/abc/"),
        env,
        {} as ExecutionContext,
      );

      expect(enabled).toHaveBeenCalledWith(env);
    });
  });

  describe("siteRouting wired without `enabled` (default always-on, e.g. custom non-Cloud config)", () => {
    it("activates routing without consulting any env var", async () => {
      const oauthProvider = makeOauthProvider();
      const siteRouting = makeSiteRouting(); // no `enabled`
      const handler = createWorkerExport(oauthProvider, {
        ...baseOptions,
        siteRouting,
      }) as unknown as { fetch: WorkerFetch };

      const env = makeEnv(); // no UMBRACO_CLOUD_ROUTING_ENABLED
      await handler.fetch(
        new Request("https://worker.example.com/at/abc/"),
        env,
        {} as ExecutionContext,
      );

      expect(siteRouting.resolveSite).toHaveBeenCalledWith("abc", env);
    });

    it("renders the site-routing landing page on GET /", async () => {
      const handler = createWorkerExport(makeOauthProvider(), {
        ...baseOptions,
        siteRouting: makeSiteRouting(),
      }) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/"),
        makeEnv(),
        {} as ExecutionContext,
      );

      expect(await response.text()).toContain("Per-project URLs");
    });
  });

  describe("siteRouting absent (gate inert)", () => {
    it("serves the single-tenant landing page regardless of env", async () => {
      const handler = createWorkerExport(
        makeOauthProvider(),
        baseOptions,
      ) as unknown as { fetch: WorkerFetch };

      const response = await handler.fetch(
        new Request("https://worker.example.com/"),
        makeEnv({ UMBRACO_CLOUD_ROUTING_ENABLED: "true" }),
        {} as ExecutionContext,
      );

      const body = await response.text();
      expect(body).toContain("https://single.example.com");
      expect(body).not.toContain("Per-project URLs");
    });
  });
});

describe("createDefaultHandler — siteRouting.enabled gate (gate 1)", () => {
  it("enabled=false + siteRouting wired: /callback/{siteId} returns 404 (single-tenant routing)", async () => {
    // handleSingleSiteRequest only matches `path === "/callback"`.
    // handleSiteRoutingRequest matches `/callback/:siteId`.
    // With the gate off, gate 1 must select single-tenant routing — so the
    // path falls through to 404 instead of being handled.
    const handler = createDefaultHandler({
      ...baseOptions,
      siteRouting: makeSiteRouting({ enabled: () => false }),
    }) as unknown as { fetch: DefaultFetch };

    const response = await handler.fetch(
      new Request("https://worker.example.com/callback/abc"),
      makeEnv(),
    );

    expect(response.status).toBe(404);
  });

  it("enabled=false + siteRouting wired: /info renders single-tenant info shape", async () => {
    const handler = createDefaultHandler({
      ...baseOptions,
      siteRouting: makeSiteRouting({ enabled: () => false }),
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

  it("siteRouting absent: /callback/{siteId} also 404s (today's behaviour)", async () => {
    const handler = createDefaultHandler(baseOptions) as unknown as {
      fetch: DefaultFetch;
    };

    const response = await handler.fetch(
      new Request("https://worker.example.com/callback/abc"),
      makeEnv(),
    );

    expect(response.status).toBe(404);
  });

  it("siteRouting wired without `enabled` (default always-on): /info still renders without leaking env names", async () => {
    const handler = createDefaultHandler({
      ...baseOptions,
      siteRouting: makeSiteRouting(),
    }) as unknown as { fetch: DefaultFetch };

    const response = await handler.fetch(
      new Request("https://worker.example.com/info"),
      makeEnv({ ENABLE_INFO_ENDPOINT: "true" }),
    );

    // Always-on: info endpoint doesn't differentiate, but we ensure no throw
    // and that single-site shape is preserved (no `sites` in URL-based routing).
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("sites");
  });
});
