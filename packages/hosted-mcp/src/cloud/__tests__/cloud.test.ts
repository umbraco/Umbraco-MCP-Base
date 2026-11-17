import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import { umbracoCloudSiteRouting } from "../index.js";

/** Minimal KV: enough for the Cloud preset's "seen before" marker. */
function createMockKV(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    put: jest.fn(async (key: string, value: string, _opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    }),
  };
}

const withKv = (kv: ReturnType<typeof createMockKV>, base: HostedMcpEnv): HostedMcpEnv =>
  ({ ...base, OAUTH_KV: kv }) as unknown as HostedMcpEnv;

// Emptied before each test, so no test sees another's seen-markers.
const baseKv = createMockKV();
const env = {
  UMBRACO_CLOUD_REGION: "euwest01",
  UMBRACO_CLOUD_ROUTING_ENABLED: "true",
  OAUTH_KV: baseKv,
} as unknown as HostedMcpEnv;

describe("umbracoCloudSiteRouting", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    baseKv.store.clear();
    baseKv.get.mockClear();
    baseKv.put.mockClear();
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

  it("throws when the discovery probe network call fails for a site seen before", async () => {
    fetchSpy.mockRejectedValue(new Error("DNS failure for secret-alias.example"));
    const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
    const kv = createMockKV({ "cloud_site_seen:known": "1" });
    const result = config.resolveSite("known", withKv(kv, env));
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

  it("caches an unreachable, previously seen site for the error TTL, then probes again", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    fetchSpy.mockRejectedValue(timeout);
    const kvEnv = withKv(createMockKV({ "cloud_site_seen:abc": "1" }), env);
    const nowSpy = jest.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(1_000_000);
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      await expect(config.resolveSite("abc", kvEnv)).rejects.toThrow("site probe failed: TimeoutError");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1_005_000);
      await expect(config.resolveSite("abc", kvEnv)).rejects.toThrow("site probe failed: TimeoutError");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1_010_001);
      await expect(config.resolveSite("abc", kvEnv)).rejects.toThrow("site probe failed: TimeoutError");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  describe("a probe that gets no answer (what a non-existent alias returns)", () => {
    const timeout = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

    it.each(["no-such-project", "no-such-project.uksouth01"])(
      "treats %s as missing when the site was never resolved, and caches the miss",
      async (alias) => {
        fetchSpy.mockRejectedValue(timeout());
        const kv = createMockKV();
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        expect(await config.resolveSite(alias, withKv(kv, env))).toBeNull();
        expect(await config.resolveSite(alias, withKv(kv, env))).toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(kv.put).not.toHaveBeenCalled();
      }
    );

    it("treats a DNS failure (e.g. a mistyped region) as missing too", async () => {
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      expect(await config.resolveSite("abc.euwets01", withKv(createMockKV(), env))).toBeNull();
    });

    it("is unreachable for a signed-in caller, even with no marker and a cached unseen miss", async () => {
      fetchSpy.mockRejectedValue(timeout());
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      expect(await config.resolveSite("abc", env)).toBeNull();
      await expect(config.resolveSite("abc", env, { signedIn: true })).rejects.toThrow(
        "site probe failed: TimeoutError"
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("still answers a signed-in caller from a cached 404", async () => {
      fetchSpy.mockResolvedValue(new Response("nope", { status: 404 }));
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      expect(await config.resolveSite("abc", env)).toBeNull();
      expect(await config.resolveSite("abc", env, { signedIn: true })).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("retries a failed marker write on the next uncached resolve", async () => {
      const kv = createMockKV();
      kv.put.mockRejectedValueOnce(new Error("KV down"));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const nowSpy = jest.spyOn(Date, "now");
      try {
        nowSpy.mockReturnValue(1_000_000);
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        await config.resolveSite("abc", withKv(kv, env));
        nowSpy.mockReturnValue(1_060_001);
        await config.resolveSite("abc", withKv(kv, env));
        expect(kv.put).toHaveBeenCalledTimes(2);
        expect(kv.store.has("cloud_site_seen:abc")).toBe(true);
      } finally {
        nowSpy.mockRestore();
        warn.mockRestore();
      }
    });

    it("marks a resolved site in KV once, with a TTL", async () => {
      const kv = createMockKV();
      const nowSpy = jest.spyOn(Date, "now");
      try {
        nowSpy.mockReturnValue(1_000_000);
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        await config.resolveSite("abc", withKv(kv, env));
        nowSpy.mockReturnValue(1_060_001);
        await config.resolveSite("abc", withKv(kv, env));
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(kv.put).toHaveBeenCalledTimes(1);
        expect(kv.put).toHaveBeenCalledWith("cloud_site_seen:abc", "1", {
          expirationTtl: 30 * 24 * 60 * 60,
        });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("is unreachable for a site this isolate resolved earlier, without reading KV", async () => {
      const kv = createMockKV();
      const nowSpy = jest.spyOn(Date, "now");
      try {
        nowSpy.mockReturnValue(1_000_000);
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        expect(await config.resolveSite("abc", withKv(kv, env))).not.toBeNull();
        fetchSpy.mockRejectedValue(timeout());
        nowSpy.mockReturnValue(1_060_001);
        await expect(config.resolveSite("abc", withKv(kv, env))).rejects.toThrow(
          "site probe failed: TimeoutError"
        );
        expect(kv.get).not.toHaveBeenCalled();
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("is unreachable in a fresh isolate for a site another isolate marked in KV", async () => {
      const kv = createMockKV();
      await umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" }).resolveSite(
        "abc",
        withKv(kv, env)
      );
      fetchSpy.mockRejectedValue(timeout());
      const fresh = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      await expect(fresh.resolveSite("abc", withKv(kv, env))).rejects.toThrow(
        "site probe failed: TimeoutError"
      );
    });

    it("still resolves a site when the marker write fails", async () => {
      const kv = createMockKV();
      kv.put.mockRejectedValue(new Error("KV put failed for cloud_site_seen:secret-alias"));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        expect(await config.resolveSite("secret-alias", withKv(kv, env))).not.toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/seen-marker write failed: Error$/);
        expect(warn.mock.calls.flat().join(" ")).not.toContain("secret-alias");
      } finally {
        warn.mockRestore();
      }
    });

    it("is still unreachable in this isolate after a failed marker write", async () => {
      const kv = createMockKV();
      kv.put.mockRejectedValue(new Error("KV down"));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const nowSpy = jest.spyOn(Date, "now");
      try {
        nowSpy.mockReturnValue(1_000_000);
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        expect(await config.resolveSite("abc", withKv(kv, env))).not.toBeNull();
        fetchSpy.mockRejectedValue(timeout());
        nowSpy.mockReturnValue(1_060_001);
        await expect(config.resolveSite("abc", withKv(kv, env))).rejects.toThrow(
          "site probe failed: TimeoutError"
        );
      } finally {
        nowSpy.mockRestore();
        warn.mockRestore();
      }
    });

    it("keeps the unseen miss for the miss TTL, not the error TTL", async () => {
      fetchSpy.mockRejectedValue(timeout());
      const nowSpy = jest.spyOn(Date, "now");
      try {
        nowSpy.mockReturnValue(1_000_000);
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        expect(await config.resolveSite("nope", env)).toBeNull();
        nowSpy.mockReturnValue(1_010_001);
        expect(await config.resolveSite("nope", env)).toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        nowSpy.mockReturnValue(1_030_001);
        expect(await config.resolveSite("nope", env)).toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("writes one marker for every case variant of an alias", async () => {
      const kv = createMockKV();
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      for (const alias of ["abc.uksouth01", "ABC.uksouth01", "Abc.UkSouth01"]) {
        await config.resolveSite(alias, withKv(kv, env));
      }
      expect(kv.put).toHaveBeenCalledTimes(1);
      expect([...kv.store.keys()]).toEqual(["cloud_site_seen:abc.uksouth01"]);
    });

    it("writes no marker for an id that isn't `<alias>` or `<alias>.<region>`", async () => {
      const kv = createMockKV();
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      for (const alias of ["a.b.c", "user@abc", "a_b", "a".repeat(64)]) {
        await config.resolveSite(alias, withKv(kv, env));
      }
      expect(kv.put).not.toHaveBeenCalled();
    });

    it("writes no marker when a custom validateProject is set, and its timeout-shaped throw stays unreachable", async () => {
      const kv = createMockKV();
      const validateProject = jest
        .fn<(siteId: string, baseUrl: string, env: HostedMcpEnv) => boolean>()
        .mockReturnValueOnce(true)
        .mockImplementation(() => {
          throw Object.assign(new Error("site probe failed: TimeoutError"), { name: "TimeoutError" });
        });
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor", validateProject });
      expect(await config.resolveSite("abc", withKv(kv, env))).not.toBeNull();
      expect(kv.put).not.toHaveBeenCalled();
      await expect(config.resolveSite("never-seen", withKv(kv, env))).rejects.toThrow(
        "site probe failed: TimeoutError"
      );
    });

    it("is unreachable when the marker can't be read, and keeps the alias out of the logs", async () => {
      fetchSpy.mockRejectedValue(timeout());
      const kv = createMockKV();
      kv.get.mockRejectedValue(new Error("KV get failed for cloud_site_seen:secret-alias"));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        const result = config.resolveSite("secret-alias", withKv(kv, env));
        await expect(result).rejects.toThrow("site probe failed: TimeoutError");
        await expect(result).rejects.not.toThrow("secret-alias");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/seen-marker read failed: Error$/);
        expect(warn.mock.calls.flat().join(" ")).not.toContain("secret-alias");
      } finally {
        warn.mockRestore();
      }
    });

    it("keeps a 503 unreachable for a site never resolved: the site answered", async () => {
      fetchSpy.mockResolvedValue(new Response("down", { status: 503 }));
      const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
      await expect(config.resolveSite("abc", withKv(createMockKV(), env))).rejects.toThrow(
        "status=503"
      );
    });

    it("logs the rejection by siteRef only", async () => {
      fetchSpy.mockRejectedValue(timeout());
      const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        const config = umbracoCloudSiteRouting({ oauthClientId: "mcp-cms-editor" });
        const hashEnv = { ...env, TENANT_HASH_KEY: "ab".repeat(32) } as HostedMcpEnv;
        expect(await config.resolveSite("secret-alias", hashEnv)).toBeNull();
        const lines = log.mock.calls.map((c) => c.map(String).join(" "));
        expect(lines.filter((l) => /^site-probe site=[0-9a-f]{12} no-answer unseen cause=TimeoutError$/.test(l))).toHaveLength(1);
        expect(lines.some((l) => l.includes("secret-alias"))).toBe(false);
      } finally {
        log.mockRestore();
      }
    });
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
