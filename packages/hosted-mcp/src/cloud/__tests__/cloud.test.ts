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

  it("throws when the discovery probe network call fails", async () => {
    fetchSpy.mockRejectedValue(new Error("DNS failure for secret-alias.example"));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const result = config.resolveSite("missing", env);
    await expect(result).rejects.toThrow("site probe failed: Error");
    await expect(result).rejects.not.toThrow("secret-alias");
    const e = (await Promise.resolve(result).catch((x: unknown) => x)) as Error;
    expect(e.cause).toBeUndefined();
  });

  it("throws for a 503 with the status in the message", async () => {
    fetchSpy.mockResolvedValue(new Response("down", { status: 503 }));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    await expect(config.resolveSite("abc", env)).rejects.toThrow("status=503");
    await expect(config.resolveSite("abc", env)).rejects.toThrow("status=503");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws for a 429", async () => {
    fetchSpy.mockResolvedValue(new Response("slow down", { status: 429 }));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    await expect(config.resolveSite("abc", env)).rejects.toThrow("status=429");
  });

  it.each([401, 403])("returns null for a %i", async (status) => {
    fetchSpy.mockResolvedValue(new Response("no", { status }));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    expect(await config.resolveSite("abc", env)).toBeNull();
  });

  it("treats an alias that cannot be a hostname as missing, without fetching", async () => {
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    for (const alias of ["a%20b", "a:b", "a[b"]) {
      expect(await config.resolveSite(alias, env)).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs a missing site by siteRef only, never the alias or URL", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 404 }));
    const spies = (["log", "error", "warn"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined)
    );
    try {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const hashEnv = { ...env, TENANT_HASH_KEY: "ab".repeat(32) } as HostedMcpEnv;
      expect(await config.resolveSite("secret-alias", hashEnv)).toBeNull();
      const lines = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")));
      expect(lines.filter((l) => /^site-probe site=[0-9a-f]{12} status=404$/.test(l))).toHaveLength(1);
      expect(lines.some((l) => l.includes("secret-alias") || l.includes("umbraco.io"))).toBe(false);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it("caches a custom validateProject throw for the error TTL", async () => {
    const validateProject = jest
      .fn<(siteId: string, baseUrl: string, env: HostedMcpEnv) => boolean>()
      .mockImplementation(() => {
        throw new Error("portal API down");
      });
    const nowSpy = jest.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(2_000_000);
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor", validateProject });
      await expect(config.resolveSite("abc", env)).rejects.toThrow(/portal API down/);
      expect(validateProject).toHaveBeenCalledTimes(1);
      nowSpy.mockReturnValue(2_005_000);
      await expect(config.resolveSite("abc", env)).rejects.toThrow(/portal API down/);
      expect(validateProject).toHaveBeenCalledTimes(1);
      nowSpy.mockReturnValue(2_010_001);
      await expect(config.resolveSite("abc", env)).rejects.toThrow(/portal API down/);
      expect(validateProject).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("counts the error TTL from when the probe failed, and rethrows the validator's own error", async () => {
    class PortalError extends Error {}
    const failure = new PortalError("portal API down");
    const nowSpy = jest.spyOn(Date, "now");
    // The probe takes 5s to fail, like the default validator's timeout.
    const validateProject = jest
      .fn<(siteId: string, baseUrl: string, env: HostedMcpEnv) => boolean>()
      .mockImplementation(() => {
        nowSpy.mockReturnValue(3_005_000);
        throw failure;
      });
    try {
      nowSpy.mockReturnValue(3_000_000);
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor", validateProject });
      await expect(config.resolveSite("abc", env)).rejects.toBe(failure);

      // 12s after the probe started, 7s after it failed: still inside the 10s TTL.
      nowSpy.mockReturnValue(3_012_000);
      await expect(config.resolveSite("abc", env)).rejects.toBe(failure);
      expect(validateProject).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(3_015_001);
      await expect(config.resolveSite("abc", env)).rejects.toBe(failure);
      expect(validateProject).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("counts the miss TTL from when the probe ended", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(7_000_000);
      // The probe takes 5s to come back with a 404.
      fetchSpy.mockImplementation(async () => {
        nowSpy.mockReturnValue(7_005_000);
        return new Response("nope", { status: 404 });
      });
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      expect(await config.resolveSite("abc", env)).toBeNull();
      // 32s after the probe started, 27s after it ended: inside the 30s TTL.
      nowSpy.mockReturnValue(7_032_000);
      expect(await config.resolveSite("abc", env)).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("caches an unreachable site for the error TTL, then probes again", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    fetchSpy.mockRejectedValue(timeout);
    const nowSpy = jest.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(1_000_000);
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      await expect(config.resolveSite("abc", env)).rejects.toThrow("site probe failed: TimeoutError");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1_005_000);
      await expect(config.resolveSite("abc", env)).rejects.toThrow("site probe failed: TimeoutError");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1_010_001);
      await expect(config.resolveSite("abc", env)).rejects.toThrow("site probe failed: TimeoutError");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
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

  describe("embedded region (`<alias>.<region>` siteId)", () => {
    it("resolves directly from the embedded region with a single validation call", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("example-project.uksouth01", env);
      expect(site?.baseUrl).toBe(
        "https://example-project.uksouth01.umbraco.io"
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example-project.uksouth01.umbraco.io/umbraco",
        expect.anything()
      );
    });

    it("ignores the `region` option/env var when the siteId carries its own region", async () => {
      const config = umbracoCloudSiteRouting({
        oauthClientId: "mcp-cms-editor",
        region: "useast01",
      });
      const site = await config.resolveSite("abc.uksouth01", env);
      expect(site?.baseUrl).toBe("https://abc.uksouth01.umbraco.io");
    });

    it("returns null when the embedded region doesn't validate", async () => {
      fetchSpy.mockResolvedValue(new Response("nope", { status: 404 }));
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("abc.uksouth01", env);
      expect(site).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("treats a bare alias with no region suffix via the `region` fallback", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("plain-alias", env);
      expect(site?.baseUrl).toBe("https://plain-alias.euwest01.umbraco.io");
    });

    it("keeps the full `<alias>.<region>` string as the site id and display name", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("abc.uksouth01", env);
      expect(site?.id).toBe("abc.uksouth01");
      expect(site?.displayName).toBe("abc.uksouth01");
    });

    it("sets callbackId to the bare alias, since Umbraco's own OAuth client registration doesn't know about regions", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("abc.uksouth01", env);
      expect(site?.callbackId).toBe("abc");
    });

    it("leaves callbackId unset for a bare alias (id already matches what Umbraco expects)", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("plain-alias", env);
      expect(site?.callbackId).toBeUndefined();
    });

    it("carries the embedded region as `region`, without touching `id`", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("abc.uksouth01", env);
      expect(site?.region).toBe("uksouth01");
      expect(site?.id).toBe("abc.uksouth01");
    });

    it("sets `region` to the resolved default for a bare alias, without touching `id`", async () => {
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      const site = await config.resolveSite("plain-alias", env);
      expect(site?.region).toBe("euwest01");
      expect(site?.id).toBe("plain-alias");
    });

    it("uses the `region` option, not the hardcoded default, for a bare alias' `region`", async () => {
      const config = umbracoCloudSiteRouting({
        oauthClientId: "mcp-cms-editor",
        region: "useast01",
      });
      const site = await config.resolveSite("plain-alias", env);
      expect(site?.region).toBe("useast01");
    });
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
