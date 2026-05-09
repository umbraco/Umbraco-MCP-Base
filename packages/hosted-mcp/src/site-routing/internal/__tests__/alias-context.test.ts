import { describe, it, expect, jest } from "@jest/globals";
import {
  canonicalResourceForAlias,
  resolveAliasFromUrl,
} from "../alias-context.js";
import type { HostedMcpEnv } from "../../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../../types/multi-site.js";

describe("canonicalResourceForAlias", () => {
  it("returns origin + /at/<alias> with no trailing slash", () => {
    expect(canonicalResourceForAlias("https://worker.example.com", "demo")).toBe(
      "https://worker.example.com/at/demo"
    );
  });

  it("strips a trailing slash from origin if accidentally provided", () => {
    expect(canonicalResourceForAlias("https://worker.example.com/", "demo")).toBe(
      "https://worker.example.com/at/demo"
    );
  });

  it("does not URL-encode the alias (alias is opaque)", () => {
    expect(canonicalResourceForAlias("https://x", "abc-123_xyz")).toBe(
      "https://x/at/abc-123_xyz"
    );
  });
});

describe("resolveAliasFromUrl", () => {
  const siteFixture: SiteConfig = {
    id: "demo",
    displayName: "Demo",
    baseUrl: "https://demo.example.com",
    oauthClientId: "demo-client",
  };
  const env = {} as HostedMcpEnv;

  function makeRouting(
    resolve: jest.Mock<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>,
    pathPrefix = "/at/:siteId"
  ): SiteRoutingConfig {
    return { pathPrefix, resolveSite: resolve };
  }

  it("returns alias and resolved site when the URL matches", async () => {
    const resolve = jest
      .fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockResolvedValue(siteFixture);
    const result = await resolveAliasFromUrl(
      new URL("https://worker.example.com/at/demo/authorize"),
      makeRouting(resolve),
      env
    );
    if ("rejected" in result) throw new Error("expected ok");
    expect(result.alias).toBe("demo");
    expect(result.site).toEqual(siteFixture);
    expect(resolve).toHaveBeenCalledWith("demo", env);
  });

  it("returns rejected:404 when the URL has no alias prefix", async () => {
    const resolve = jest.fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>();
    const result = await resolveAliasFromUrl(
      new URL("https://worker.example.com/authorize"),
      makeRouting(resolve),
      env
    );
    expect("rejected" in result && result.rejected.status).toBe(404);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns rejected:404 when resolveSite returns null", async () => {
    const resolve = jest
      .fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockResolvedValue(null);
    const result = await resolveAliasFromUrl(
      new URL("https://worker.example.com/at/missing/authorize"),
      makeRouting(resolve),
      env
    );
    expect("rejected" in result && result.rejected.status).toBe(404);
  });

  it("returns rejected:502 when resolveSite throws", async () => {
    const resolve = jest
      .fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockRejectedValue(new Error("upstream"));
    const result = await resolveAliasFromUrl(
      new URL("https://worker.example.com/at/demo/authorize"),
      makeRouting(resolve),
      env
    );
    expect("rejected" in result && result.rejected.status).toBe(502);
  });
});
