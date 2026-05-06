import { describe, expect, it, jest } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";
import { createSiteRouter } from "../site-router.js";

const env = {} as HostedMcpEnv;
const ctx = {} as ExecutionContext;

const sampleSite: SiteConfig = {
  id: "abc",
  displayName: "abc",
  baseUrl: "https://abc.example.com",
  oauthClientId: "mcp-cms-editor",
};

function makeInner(captured: { request: Request | null }) {
  return async (request: Request) => {
    captured.request = request;
    return new Response("ok-from-inner", { status: 200 });
  };
}

describe("createSiteRouter", () => {
  it("rewrites a matching prefix to rewriteTo and delegates to inner", async () => {
    const captured = { request: null as Request | null };
    const config: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: () => sampleSite,
    };

    const router = createSiteRouter(
      config,
      { rewriteTo: "/mcp" },
      makeInner(captured)
    );

    const response = await router.fetch(
      new Request("https://host/at/abc/", { method: "POST" }),
      env,
      ctx
    );

    expect(response.status).toBe(200);
    expect(captured.request).not.toBeNull();
    expect(new URL(captured.request!.url).pathname).toBe("/mcp");
    expect(captured.request!.method).toBe("POST");
  });

  it("passes through non-matching requests to inner unchanged", async () => {
    const captured = { request: null as Request | null };
    const config: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: () => sampleSite,
    };

    const router = createSiteRouter(
      config,
      { rewriteTo: "/mcp" },
      makeInner(captured)
    );

    await router.fetch(
      new Request("https://host/authorize"),
      env,
      ctx
    );

    expect(new URL(captured.request!.url).pathname).toBe("/authorize");
  });

  it("returns 404 JSON when resolveSite returns null", async () => {
    const captured = { request: null as Request | null };
    const config: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: () => null,
    };

    const router = createSiteRouter(
      config,
      { rewriteTo: "/mcp" },
      makeInner(captured)
    );

    const response = await router.fetch(
      new Request("https://host/at/missing/"),
      env,
      ctx
    );

    expect(response.status).toBe(404);
    expect(captured.request).toBeNull();
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("missing");
  });

  it("calls renderNotFound when provided", async () => {
    const captured = { request: null as Request | null };
    const renderNotFound = jest.fn(
      (siteId: string) =>
        new Response(`<html>not found: ${siteId}</html>`, {
          status: 404,
          headers: { "Content-Type": "text/html" },
        })
    );
    const config: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: () => null,
      renderNotFound,
    };

    const router = createSiteRouter(
      config,
      { rewriteTo: "/mcp" },
      makeInner(captured)
    );

    const response = await router.fetch(
      new Request("https://host/at/missing/"),
      env,
      ctx
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(await response.text()).toContain("not found: missing");
    expect(renderNotFound).toHaveBeenCalledWith(
      "missing",
      expect.any(Request)
    );
  });

  it("returns 502 JSON when resolveSite throws", async () => {
    const captured = { request: null as Request | null };
    const config: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: () => {
        throw new Error("upstream broke");
      },
    };

    const router = createSiteRouter(
      config,
      { rewriteTo: "/mcp" },
      makeInner(captured)
    );

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await router.fetch(
      new Request("https://host/at/abc/"),
      env,
      ctx
    );

    expect(response.status).toBe(502);
    expect(captured.request).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("preserves the request body and headers across rewrite", async () => {
    const captured = { request: null as Request | null };
    const config: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: () => sampleSite,
    };

    const router = createSiteRouter(
      config,
      { rewriteTo: "/mcp" },
      makeInner(captured)
    );

    const original = new Request("https://host/at/abc/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer abc123",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
    });

    await router.fetch(original, env, ctx);

    expect(captured.request!.method).toBe("POST");
    expect(captured.request!.headers.get("Authorization")).toBe("Bearer abc123");
    expect(captured.request!.headers.get("Content-Type")).toBe("application/json");
    expect(await captured.request!.json()).toEqual({
      jsonrpc: "2.0",
      method: "tools/list",
    });
  });

  it("exposes the compiled prefixRegex for callers that probe the path cheaply", () => {
    const config: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: () => sampleSite,
    };
    const router = createSiteRouter(config, {}, async () => new Response());

    expect(router.prefixRegex.test("/at/foo/")).toBe(true);
    expect(router.prefixRegex.test("/authorize")).toBe(false);
  });
});
