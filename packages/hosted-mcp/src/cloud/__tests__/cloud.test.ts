import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import { umbracoCloudSiteRouting } from "../index.js";

const env = {
  UMBRACO_CLOUD_REGION: "euwest01",
  UMBRACO_CLOUD_ROUTING_ENABLED: "true",
} as HostedMcpEnv;

describe("umbracoCloudSiteRouting", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ issuer: "https://example.umbraco.io" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("uses /at/:siteId as the default path prefix", () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    expect(config.pathPrefix).toBe("/at/:siteId");
  });

  it("composes the Cloud URL using region from env", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const site = await config.resolveSite("hosted-mcp-worker-test", env);
    expect(site?.baseUrl).toBe(
      "https://hosted-mcp-worker-test.euwest01.umbraco.io"
    );
  });

  it("falls back to the default region when env var is missing", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const site = await config.resolveSite(
      "abc",
      { UMBRACO_CLOUD_ROUTING_ENABLED: "true" } as HostedMcpEnv
    );
    expect(site?.baseUrl).toBe("https://abc.euwest01.umbraco.io");
  });

  it("prefers the `region` option over the env var", async () => {
    const config = umbracoCloudSiteRouting({
      oauthClientId: "mcp-cms-editor",
      region: "useast01",
    });
    const site = await config.resolveSite("abc", env);
    expect(site?.baseUrl).toBe("https://abc.useast01.umbraco.io");
  });

  it("preserves dev- prefixed aliases verbatim", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const site = await config.resolveSite(
      "dev-hosted-mcp-worker-test",
      env
    );
    expect(site?.baseUrl).toBe(
      "https://dev-hosted-mcp-worker-test.euwest01.umbraco.io"
    );
  });

  it("uses the supplied oauthClientId for every project", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const a = await config.resolveSite("project-a", env);
    const b = await config.resolveSite("project-b", env);
    expect(a?.oauthClientId).toBe("mcp-cms-editor");
    expect(b?.oauthClientId).toBe("mcp-cms-editor");
  });

  it("omits the secret for PKCE/public clients (no resolveOauthClientSecret)", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const site = await config.resolveSite("abc", env);
    expect(site?.oauthClientSecret).toBeUndefined();
  });

  it("attaches a per-project secret when resolveOauthClientSecret is provided", async () => {
    const config = umbracoCloudSiteRouting({
      oauthClientId: "mcp-cms-editor",
      resolveOauthClientSecret: (siteId) => `secret-for-${siteId}`,
    });
    const site = await config.resolveSite("abc", env);
    expect(site?.oauthClientSecret).toBe("secret-for-abc");
  });

  it("returns null when the project's discovery probe is non-2xx", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 404 }));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const site = await config.resolveSite("missing", env);
    expect(site).toBeNull();
  });

  it("returns null when the discovery probe network call fails", async () => {
    fetchSpy.mockRejectedValue(new Error("DNS failure"));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const site = await config.resolveSite("missing", env);
    expect(site).toBeNull();
  });

  it("sends the firewall-allowlist header on the reachability probe when configured", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    await config.resolveSite("abc", { ...env, UMBRACO_MCP_HEADER_VALUE: "secret-value" } as HostedMcpEnv);

    const [, options] = fetchSpy.mock.calls[0];
    expect((options as RequestInit).headers).toEqual(
      expect.objectContaining({ "X-Umbraco-Mcp": "secret-value" })
    );
  });

  it("sends no extra header on the reachability probe when not configured", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    await config.resolveSite("abc", env);

    const [, options] = fetchSpy.mock.calls[0];
    expect(Object.keys((options as RequestInit).headers as Record<string, string>)).not.toContain(
      "X-Umbraco-Mcp"
    );
  });

  it("supports a custom validateProject hook", async () => {
    const validateProject = jest.fn<
      (siteId: string, baseUrl: string, env: HostedMcpEnv) => boolean
    >().mockReturnValue(true);
    const config = umbracoCloudSiteRouting({
      oauthClientId: "mcp-cms-editor",
      validateProject,
    });
    const site = await config.resolveSite("abc", env);
    expect(site).not.toBeNull();
    expect(validateProject).toHaveBeenCalledWith(
      "abc",
      "https://abc.euwest01.umbraco.io",
      env
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates throws from validateProject (router maps to 502)", async () => {
    const config = umbracoCloudSiteRouting({
      oauthClientId: "mcp-cms-editor",
      validateProject: () => {
        throw new Error("portal API down");
      },
    });
    await expect(config.resolveSite("abc", env)).rejects.toThrow(
      /portal API down/
    );
  });

  it("caches successful resolutions across calls (default 60s TTL)", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    await config.resolveSite("abc", env);
    await config.resolveSite("abc", env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches missing projects (avoids re-probing for the miss TTL)", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 404 }));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    await config.resolveSite("missing", env);
    await config.resolveSite("missing", env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("respects custom pathPrefix override", () => {
    const config = umbracoCloudSiteRouting({
      oauthClientId: "mcp-cms-editor",
      pathPrefix: "/p/:project",
    });
    expect(config.pathPrefix).toBe("/p/:project");
  });

  describe("UMBRACO_CLOUD_ROUTING_ENABLED gate", () => {
    it("returns null without invoking the validator when the flag is absent", async () => {
      const validateProject = jest.fn<
        (siteId: string, baseUrl: string, env: HostedMcpEnv) => boolean
      >().mockReturnValue(true);
      const config = umbracoCloudSiteRouting({
        oauthClientId: "mcp-cms-editor",
        validateProject,
      });
      const site = await config.resolveSite("abc", {
        UMBRACO_CLOUD_REGION: "euwest01",
      } as HostedMcpEnv);
      expect(site).toBeNull();
      expect(validateProject).not.toHaveBeenCalled();
    });

    it("returns null when the flag is any value other than \"true\"", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("abc", {
        UMBRACO_CLOUD_ROUTING_ENABLED: "false",
      } as HostedMcpEnv);
      expect(site).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not poison the cache when the flag flips from off to on", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const offEnv = {
        UMBRACO_CLOUD_REGION: "euwest01",
      } as HostedMcpEnv;
      expect(await config.resolveSite("abc", offEnv)).toBeNull();
      // Now the flag flips to "true" — the resolver must probe the project,
      // not return a cached miss from the off-flag call.
      const site = await config.resolveSite("abc", env);
      expect(site).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("exposes the default `enabled` predicate on the returned config", () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      expect(config.enabled).toBeDefined();
      expect(config.enabled!({ UMBRACO_CLOUD_ROUTING_ENABLED: "true" } as HostedMcpEnv)).toBe(true);
      expect(config.enabled!({ UMBRACO_CLOUD_ROUTING_ENABLED: "false" } as HostedMcpEnv)).toBe(false);
      expect(config.enabled!({} as HostedMcpEnv)).toBe(false);
    });

    it("honours a custom `enabled` override (e.g. different env var)", async () => {
      const config = umbracoCloudSiteRouting({
        oauthClientId: "mcp-cms-editor",
        enabled: (e) => (e as { MY_FLAG?: string }).MY_FLAG === "yes",
      });
      // Default-named flag is now ignored.
      expect(
        await config.resolveSite("abc", {
          UMBRACO_CLOUD_ROUTING_ENABLED: "true",
        } as HostedMcpEnv),
      ).toBeNull();
      // Custom flag flips it on.
      expect(
        await config.resolveSite("abc", {
          MY_FLAG: "yes",
          UMBRACO_CLOUD_REGION: "euwest01",
        } as unknown as HostedMcpEnv),
      ).not.toBeNull();
    });

    it("supports always-on (`enabled: () => true`) for non-flag deployments", async () => {
      const config = umbracoCloudSiteRouting({
        oauthClientId: "mcp-cms-editor",
        enabled: () => true,
      });
      const site = await config.resolveSite("abc", {
        UMBRACO_CLOUD_REGION: "euwest01",
      } as HostedMcpEnv);
      expect(site).not.toBeNull();
    });
  });
});
