/**
 * Request-Scoped Telemetry Value Tests
 *
 * Two things are being protected:
 *
 * 1. **The alias never escapes.** The tenant attribute must be a keyed hash of
 *    the whole `siteId`, stable for a given project and different for a
 *    different one — and it must be absent rather than guessed when the key or
 *    the siteId isn't there.
 * 2. **Absent stays absent.** A self-hosted site has no region; an unauthed
 *    request has no login session. Neither may turn into an empty string, a
 *    placeholder, or a hash of `undefined`.
 */

import { describe, it, expect, jest, afterEach } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../types/auth.js";
import { hashWithKey, resolveRequestTelemetry } from "../request-telemetry.js";
import { aliasOnly, regionOnly, hasEmbeddedRegion } from "../../cloud/site-id.js";

const HASH_KEY = "0123456789abcdef0123456789abcdef";

function makeEnv(overrides: Partial<HostedMcpEnv> = {}): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test-client",
    COOKIE_ENCRYPTION_KEY: "0".repeat(64),
    TENANT_HASH_KEY: HASH_KEY,
    ...overrides,
  } as unknown as HostedMcpEnv;
}

function makeProps(overrides: Partial<AuthProps> = {}): AuthProps {
  return {
    umbracoTokenKey: "token-key-abc",
    userId: "user-1",
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("site-id splitting", () => {
  it("extracts the region from the Cloud preset's <alias>.<region> shape", () => {
    expect(regionOnly("example-project.euwest01")).toBe("euwest01");
    expect(aliasOnly("example-project.euwest01")).toBe("example-project");
    expect(hasEmbeddedRegion("example-project.euwest01")).toBe(true);
  });

  it("splits on the last dot, so a dotted alias keeps its dots", () => {
    expect(regionOnly("my.dotted.alias.uksouth01")).toBe("uksouth01");
    expect(aliasOnly("my.dotted.alias.uksouth01")).toBe("my.dotted.alias");
  });

  it("leaves the region unset for a bare, self-hosted siteId", () => {
    expect(regionOnly("self-hosted")).toBeUndefined();
    expect(aliasOnly("self-hosted")).toBe("self-hosted");
    expect(hasEmbeddedRegion("self-hosted")).toBe(false);
  });

  it("does not mistake an alias that merely contains a dot for a region", () => {
    // The suffix pattern is deliberately narrow: letters plus two digits.
    expect(regionOnly("staging.example")).toBeUndefined();
    expect(regionOnly("project.eu")).toBeUndefined();
    expect(regionOnly("project.euwest1")).toBeUndefined();
  });
});

describe("hashWithKey", () => {
  it("is stable for the same value across calls", async () => {
    const first = await hashWithKey("example-project.euwest01", HASH_KEY);
    const second = await hashWithKey("example-project.euwest01", HASH_KEY);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for a different value", async () => {
    const a = await hashWithKey("project-a.euwest01", HASH_KEY);
    const b = await hashWithKey("project-b.euwest01", HASH_KEY);

    expect(a).not.toBe(b);
  });

  it("keeps two regions of the same alias distinct", async () => {
    // The whole siteId is hashed, not just the alias — so if one alias ever
    // does live in two regions, they stay two tenants.
    const west = await hashWithKey("example-project.euwest01", HASH_KEY);
    const south = await hashWithKey("example-project.uksouth01", HASH_KEY);

    expect(west).not.toBe(south);
  });

  it("differs under a different key", async () => {
    const withKey = await hashWithKey("example-project.euwest01", HASH_KEY);
    const withOther = await hashWithKey("example-project.euwest01", "a-different-key");

    expect(withKey).not.toBe(withOther);
  });

  it("never contains the plaintext alias", async () => {
    const hash = await hashWithKey("example-project.euwest01", HASH_KEY);

    expect(hash).not.toContain("example-project");
    expect(hash).not.toContain("euwest01");
  });

  it("produces a different digest for a login-session value than for a siteId under the same key", async () => {
    // Same key, different inputs — the two attributes must not collide.
    const tenant = await hashWithKey("example-project.euwest01", HASH_KEY);
    const login = await hashWithKey("token-key-abc", HASH_KEY);

    expect(tenant).not.toBe(login);
  });
});

describe("resolveRequestTelemetry", () => {
  it("resolves tenant, region and login session for a Cloud request", async () => {
    const telemetry = await resolveRequestTelemetry(
      makeProps({ consentChoices: { siteId: "example-project.euwest01" } }),
      makeEnv()
    );

    expect(telemetry.tenant).toBe(await hashWithKey("example-project.euwest01", HASH_KEY));
    expect(telemetry.region).toBe("euwest01");
    // Hashed, not forwarded as-is — `umbracoTokenKey` doubles as the KV
    // lookup key for this login's stored Umbraco tokens, so the exported
    // attribute must never equal the raw value.
    expect(telemetry.loginSession).toBe(await hashWithKey("token-key-abc", HASH_KEY));
    expect(telemetry.loginSession).not.toBe("token-key-abc");
  });

  it("omits the region for a self-hosted siteId without erroring", async () => {
    const telemetry = await resolveRequestTelemetry(
      makeProps({ consentChoices: { siteId: "self-hosted" } }),
      makeEnv()
    );

    expect(telemetry.tenant).toBe(await hashWithKey("self-hosted", HASH_KEY));
    expect(telemetry).not.toHaveProperty("region");
  });

  it("omits tenant and region entirely when no site has been chosen", async () => {
    const telemetry = await resolveRequestTelemetry(makeProps(), makeEnv());

    expect(telemetry).not.toHaveProperty("tenant");
    expect(telemetry).not.toHaveProperty("region");
    expect(telemetry.loginSession).toBe(await hashWithKey("token-key-abc", HASH_KEY));
  });

  it("omits the login session when there is no token key", async () => {
    const telemetry = await resolveRequestTelemetry(
      { userId: "user-1", umbracoTokenKey: "" } as AuthProps,
      makeEnv()
    );

    expect(telemetry).not.toHaveProperty("loginSession");
  });

  it("returns nothing at all when there are no props", async () => {
    const telemetry = await resolveRequestTelemetry(undefined, makeEnv());

    expect(telemetry).toEqual({});
  });

  it("omits the tenant — but keeps the region — when no hash key is configured", async () => {
    // Local dev, or a deployment where the secret hasn't been pushed. The
    // plaintext alias must not be emitted in the hash's place.
    const telemetry = await resolveRequestTelemetry(
      makeProps({ consentChoices: { siteId: "example-project.euwest01" } }),
      makeEnv({ TENANT_HASH_KEY: undefined })
    );

    expect(telemetry).not.toHaveProperty("tenant");
    expect(telemetry.region).toBe("euwest01");
  });

  it("omits the login session — but keeps the region — when no hash key is configured", async () => {
    // The raw token key must never be forwarded just because hashing isn't
    // available; it's a credential-store lookup key, not a low-cardinality
    // label like region.
    const telemetry = await resolveRequestTelemetry(
      makeProps({ consentChoices: { siteId: "example-project.euwest01" } }),
      makeEnv({ TENANT_HASH_KEY: undefined })
    );

    expect(telemetry).not.toHaveProperty("loginSession");
    expect(telemetry.region).toBe("euwest01");
  });

  it("treats an empty-string TENANT_HASH_KEY the same as an absent one", async () => {
    // A Wrangler secret set to "" (misconfiguration) is a distinct code path
    // from `undefined` — both must still withhold tenant and login-session,
    // never hash with an empty key.
    const telemetry = await resolveRequestTelemetry(
      makeProps({ consentChoices: { siteId: "example-project.euwest01" } }),
      makeEnv({ TENANT_HASH_KEY: "" })
    );

    expect(telemetry).not.toHaveProperty("tenant");
    expect(telemetry).not.toHaveProperty("loginSession");
    expect(telemetry.region).toBe("euwest01");
  });

  it("never hashes an absent siteId or an absent login session", async () => {
    const spy = jest.spyOn(crypto.subtle, "sign");

    await resolveRequestTelemetry({ userId: "user-1", umbracoTokenKey: "" } as AuthProps, makeEnv());

    expect(spy).not.toHaveBeenCalled();
  });

  it("drops the tenant rather than failing the request when hashing throws", async () => {
    jest.spyOn(crypto.subtle, "importKey").mockRejectedValue(new Error("boom") as never);
    jest.spyOn(console, "error").mockImplementation(() => {});

    const telemetry = await resolveRequestTelemetry(
      makeProps({ consentChoices: { siteId: "example-project.euwest01" } }),
      makeEnv()
    );

    expect(telemetry).not.toHaveProperty("tenant");
    expect(telemetry.region).toBe("euwest01");
    // Login-session hashing fails the same way, for the same reason — it
    // must be dropped too, not fall back to the raw token key.
    expect(telemetry).not.toHaveProperty("loginSession");
  });
});
