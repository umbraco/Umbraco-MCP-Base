/**
 * `createSiteRoutingApiHandler` — expired Umbraco sign-in (issue #371).
 *
 * The outer grant issued by OAuthProvider outlives Umbraco's refresh token.
 * Once the inner KV entry is gone, the wrapper must revoke the outer grant and
 * answer `401 invalid_token`, so MCP clients sign in again instead of being
 * left on the one-tool `authentication-expired` server.
 */

import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";
import { createSiteRoutingApiHandler, type FetchHandler } from "../site-router.js";
import { createWorkerExport, type HostedMcpServerOptions } from "../../server/worker-entry.js";

const TOKEN_KEY = "token-key-1";
const BEARER = "user-1:grant-1:secret-1";
const MCP_URL = "https://worker.example.com/at/abc/mcp";

function makeKv(entries: Record<string, string>) {
  return {
    get: jest.fn(async (key: string) => entries[key] ?? null),
    put: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };
}

function makeEnv(
  kv: ReturnType<typeof makeKv>,
  revokeGrant = jest.fn<(grantId: string, userId: string) => Promise<void>>(async () => undefined)
) {
  const env = {
    UMBRACO_BASE_URL: "https://abc.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: kv as unknown as KVNamespace,
    MCP_AGENT: {} as DurableObjectNamespace,
    OAUTH_PROVIDER: { revokeGrant } as unknown as HostedMcpEnv["OAUTH_PROVIDER"],
  } as HostedMcpEnv;
  return { env, revokeGrant };
}

const ctxWithProps = (props: unknown = { umbracoTokenKey: TOKEN_KEY }) =>
  ({ props }) as unknown as ExecutionContext;

function mcpRequest(authorization: string | null = `Bearer ${BEARER}`): Request {
  const headers = new Headers();
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request(MCP_URL, { method: "POST", headers });
}

function makeBase() {
  const fetch = jest.fn<FetchHandler>(async () => new Response("from-agent", { status: 200 }));
  return { fetch };
}

const storedEntry = { [`umbraco_token:${TOKEN_KEY}`]: JSON.stringify({ tokens: { access_token: "a" } }) };

describe("createSiteRoutingApiHandler — expired Umbraco sign-in", () => {
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("passes through without revoking when the inner entry is present", async () => {
    const base = makeBase();
    const kv = makeKv(storedEntry);
    const { env, revokeGrant } = makeEnv(kv);

    const response = await createSiteRoutingApiHandler(base).fetch(mcpRequest(), env, ctxWithProps());

    expect(response.status).toBe(200);
    expect(base.fetch).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledWith(`umbraco_token:${TOKEN_KEY}`);
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it("revokes the outer grant once and returns 401 invalid_token when the inner entry is missing", async () => {
    const base = makeBase();
    const { env, revokeGrant } = makeEnv(makeKv({}));

    const response = await createSiteRoutingApiHandler(base).fetch(mcpRequest(), env, ctxWithProps());

    expect(response.status).toBe(401);
    expect(base.fetch).not.toHaveBeenCalled();
    expect(revokeGrant).toHaveBeenCalledTimes(1);
    expect(revokeGrant).toHaveBeenCalledWith("grant-1", "user-1");
    const auth = response.headers.get("www-authenticate") ?? "";
    expect(auth).toMatch(/^Bearer /);
    expect(auth).toContain(`error="invalid_token"`);
    expect(auth).toContain(`resource_metadata="`);
  });

  it.each([
    ["no Authorization header", null],
    ["a non-Bearer scheme", `Basic ${BEARER}`],
    ["too few segments", "Bearer user-1:grant-1"],
    ["too many segments", "Bearer a:b:c:d"],
    ["empty segments", "Bearer ::"],
  ])("still returns 401 without revoking for a malformed token (%s)", async (_label, authorization) => {
    const { env, revokeGrant } = makeEnv(makeKv({}));

    const response = await createSiteRoutingApiHandler(makeBase()).fetch(
      mcpRequest(authorization),
      env,
      ctxWithProps()
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`error="invalid_token"`);
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it("still returns 401 when revoking the grant throws", async () => {
    const revokeGrant = jest.fn<(grantId: string, userId: string) => Promise<void>>(async () => {
      throw new Error("kv down");
    });
    const { env } = makeEnv(makeKv({}), revokeGrant);

    const response = await createSiteRoutingApiHandler(makeBase()).fetch(mcpRequest(), env, ctxWithProps());

    expect(response.status).toBe(401);
    expect(revokeGrant).toHaveBeenCalledTimes(1);
  });

  it("passes through when there is no token key to check", async () => {
    const base = makeBase();
    const { env, revokeGrant } = makeEnv(makeKv({}));

    const response = await createSiteRoutingApiHandler(base).fetch(mcpRequest(), env, ctxWithProps({}));

    expect(response.status).toBe(200);
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it("passes through (fails open) when the KV read throws", async () => {
    const base = makeBase();
    const kv = makeKv({});
    kv.get.mockRejectedValueOnce(new Error("kv unavailable"));
    const { env, revokeGrant } = makeEnv(kv);

    const response = await createSiteRoutingApiHandler(base).fetch(mcpRequest(), env, ctxWithProps());

    expect(response.status).toBe(200);
    expect(revokeGrant).not.toHaveBeenCalled();
  });
});

describe("createSiteRoutingApiHandler — 401 resource_metadata matches OAuthProvider's own", () => {
  const siteConfig: SiteConfig = {
    id: "abc",
    displayName: "abc",
    baseUrl: "https://abc.example.com",
    oauthClientId: "test-client",
  };
  const siteRouting: SiteRoutingConfig = {
    pathPrefix: "/at/:siteId",
    resolveSite: async () => siteConfig,
    enabled: () => true,
  };
  const options: HostedMcpServerOptions = {
    name: "test-mcp",
    version: "0.0.0",
    collections: [],
    modeRegistry: [],
    allModeNames: [],
    allSliceNames: [],
    siteRouting,
  };

  /**
   * A stand-in for OAuthProvider: it builds `resource_metadata` the way
   * `@cloudflare/workers-oauth-provider` 0.8.x does in `handleApiRequest`
   * (`${url.origin}/.well-known/oauth-protected-resource${url.pathname}`), then
   * either 401s itself or hands the request to the apiHandler.
   */
  function makeProvider(apiHandler: { fetch: FetchHandler }, mode: "provider-401" | "api") {
    return {
      fetch: async (request: Request, env: HostedMcpEnv, ctx: ExecutionContext) => {
        if (mode === "api") return apiHandler.fetch(request, env, ctx);
        const url = new URL(request.url);
        const resourceMetadataUrl = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
        return new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${resourceMetadataUrl}", error="invalid_token"`,
          },
        });
      },
    };
  }

  const resourceMetadata = (response: Response) =>
    (response.headers.get("www-authenticate") ?? "").match(/resource_metadata="([^"]*)"/)?.[1];

  it("carries the same resource_metadata for the same tenant", async () => {
    const { env } = makeEnv(makeKv({}));
    const apiHandler = createSiteRoutingApiHandler(makeBase());

    const providerOwn = await createWorkerExport(makeProvider(apiHandler, "provider-401"), options).fetch(
      mcpRequest(),
      env,
      ctxWithProps()
    );
    const wrapper = await createWorkerExport(makeProvider(apiHandler, "api"), options).fetch(
      mcpRequest(),
      env,
      ctxWithProps()
    );

    expect(providerOwn.status).toBe(401);
    expect(wrapper.status).toBe(401);
    expect(resourceMetadata(wrapper)).toBeDefined();
    expect(resourceMetadata(wrapper)).toBe(resourceMetadata(providerOwn));
  });
});
