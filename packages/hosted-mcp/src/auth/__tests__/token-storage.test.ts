/**
 * Token refresh — classification, the stale-rotation retry, and KV failures.
 *
 * Exercised entirely through the public `refreshUmbracoToken`, since that's the
 * only thing the fetch client and `createPerRequestServer` ever call. The
 * classification helpers are deliberately not exported: what matters is the
 * `RefreshFailureReason` a caller actually receives, because that's what decides
 * whether a session keeps its toolset (see umbraco/Umbraco-MCP-Base#320).
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { refreshUmbracoToken } from "../token-storage.js";
import type { HostedMcpEnv } from "../../types/env.js";

const originalFetch = globalThis.fetch;

/** Recorded `refresh_token` form value from each POST to the token endpoint. */
let postedRefreshTokens: string[] = [];

/**
 * A KV stub that serves a scripted sequence of stored entries, so a test can
 * make the second read of a single refresh see a rotated token.
 */
function createKv(options: {
  /** JSON payloads for successive `get` calls; the last one repeats. */
  entries?: (string | null)[];
  /** Throws from `get` instead of resolving. */
  getThrows?: boolean;
  /** Throws from `put`, simulating a KV outage on the write-back. */
  putThrows?: boolean;
} = {}) {
  const entries = options.entries ?? [null];
  let reads = 0;
  return {
    get: async () => {
      if (options.getThrows) throw new Error("kv unavailable");
      const entry = entries[Math.min(reads, entries.length - 1)];
      reads += 1;
      return entry;
    },
    put: async () => {
      if (options.putThrows) throw new Error("kv write quota exceeded");
      return undefined;
    },
    delete: async () => undefined,
  };
}

/** A stored-token envelope holding a single refresh token. */
function storedEntry(refreshToken: string): string {
  return JSON.stringify({ tokens: { access_token: "stored-access", refresh_token: refreshToken } });
}

function createEnv(kv: ReturnType<typeof createKv>): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test-client",
    OAUTH_KV: kv,
  } as unknown as HostedMcpEnv;
}

/** Serves a scripted sequence of token-endpoint responses; the last repeats. */
function respondWith(...responses: (() => Response)[]): void {
  let calls = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    postedRefreshTokens.push(body.get("refresh_token") ?? "<none>");
    const response = responses[Math.min(calls, responses.length - 1)]();
    calls += 1;
    return response;
  }) as unknown as typeof fetch;
}

const json = (payload: unknown, status: number) => () =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const text = (payload: string, status: number) => () => new Response(payload, { status });

describe("refreshUmbracoToken failure classification", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    postedRefreshTokens = [];
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it("reports a recognised client-error code as misconfigured", async () => {
    respondWith(json({ error: "invalid_client" }, 401));

    const result = await refreshUmbracoToken(createEnv(createKv()), "key-invalid-client", "rt");

    expect(result).toMatchObject({ ok: false, reason: "misconfigured", error: "invalid_client" });
  });

  it.each(["invalid_request", "invalid_scope"] as const)(
    "reports %s as a server error, not misconfigured",
    async (errorCode) => {
      // `REFRESH_MISCONFIGURED_MESSAGE` specifically tells an administrator to
      // check the client_id/secret/grant-type registration — the wrong
      // diagnostic for a malformed request or bad scope, which can come from
      // a proxy mangling the request rather than the client itself being
      // misregistered. Bucketing these as `misconfigured` would also degrade
      // a session with no retry, same as a genuinely dead refresh token.
      respondWith(json({ error: errorCode }, 400));

      const result = await refreshUmbracoToken(createEnv(createKv()), `key-${errorCode}`, "rt");

      expect(result).toMatchObject({ ok: false, reason: "server_error", error: errorCode });
    }
  );

  it.each(["invalid_client", "unauthorized_client", "unsupported_grant_type"] as const)(
    "reports %s as misconfigured",
    async (errorCode) => {
      respondWith(json({ error: errorCode }, 400));

      const result = await refreshUmbracoToken(createEnv(createKv()), `key-${errorCode}`, "rt");

      expect(result).toMatchObject({ ok: false, reason: "misconfigured", error: errorCode });
    }
  );

  it.each([
    ["invalid_client", "misconfigured"],
    ["invalid_request", "server_error"],
  ] as const)(
    "classifies %s via the non-JSON whole-word fallback scan as %s",
    async (errorCode, reason) => {
      // The JSON-body tests above never exercise `parseOAuthErrorCode`'s text
      // fallback (a proxy that rewrites the body to plain text), so a code
      // moved between `CLIENT_ERROR_CODES` and `REQUEST_ERROR_CODES` would go
      // uncaught here even though the JSON-path `it.each` blocks above cover it.
      respondWith(text(`error=${errorCode}&error_description=rejected`, 400));

      const result = await refreshUmbracoToken(createEnv(createKv()), `key-text-${errorCode}`, "rt");

      expect(result).toMatchObject({ ok: false, reason, error: errorCode });
    }
  );

  it("classifies a known error code correctly even with a stray control character", async () => {
    // Regression: `parseOAuthErrorCode` used to sanitize the error string
    // (stripping control characters) before comparing it against the known
    // OAuth codes, so "invalid_grant\u0000" no longer strictly equalled
    // "invalid_grant" — misclassifying a genuinely dead refresh token as a
    // retryable server_error instead of a definitive expired.
    respondWith(json({ error: "invalid_grant\u0000" }, 400));

    const result = await refreshUmbracoToken(createEnv(createKv()), "key-control-char", "rt");

    expect(result).toMatchObject({ ok: false, reason: "expired", error: "invalid_grant" });
  });

  it("reports a bare 5xx with no OAuth error body as a server error", async () => {
    respondWith(text("", 503));

    const result = await refreshUmbracoToken(createEnv(createKv()), "key-5xx", "rt");

    expect(result).toMatchObject({ ok: false, reason: "server_error", status: 503 });
    expect((result as { error?: string }).error).toBeUndefined();
  });

  it("reports an unattributable 4xx as a server error rather than misconfigured or expired", async () => {
    // A 4xx we cannot pin on a known client-error code must never read as a
    // definitive `expired`, nor as `misconfigured` — `misconfigured` degrades
    // the session (see create-server.ts) just like `expired` does, and a
    // WAF/CDN/rate-limiter blip in front of the token endpoint has nothing to
    // do with the client registration.
    respondWith(text("Forbidden by upstream policy", 403));

    const result = await refreshUmbracoToken(createEnv(createKv()), "key-ambiguous-4xx", "rt");

    expect(result).toMatchObject({ ok: false, reason: "server_error", status: 403 });
  });

  it("reports a 200 with an unparseable body as a server error", async () => {
    respondWith(() =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await refreshUmbracoToken(createEnv(createKv()), "key-bad-json", "rt");

    expect(result).toMatchObject({ ok: false, reason: "server_error", status: 200 });
  });

  it("reports a 200 with no access token as a server error", async () => {
    respondWith(json({ token_type: "Bearer", refresh_token: "rotated" }, 200));

    const result = await refreshUmbracoToken(createEnv(createKv()), "key-no-access-token", "rt");

    expect(result).toMatchObject({ ok: false, reason: "server_error", status: 200 });
  });

  it("reports an empty access token as a server error", async () => {
    respondWith(json({ access_token: "", token_type: "Bearer" }, 200));

    const result = await refreshUmbracoToken(createEnv(createKv()), "key-empty-access-token", "rt");

    expect(result).toMatchObject({ ok: false, reason: "server_error" });
  });

  it("starts a fresh attempt after a failure instead of replaying the settled one", async () => {
    // `inFlightRefreshes` coalesces concurrent refreshes; a settled failure must
    // not be left in the map, or every later request inherits it forever.
    respondWith(text("", 503), json({ access_token: "second-access" }, 200));
    const env = createEnv(createKv());

    const first = await refreshUmbracoToken(env, "key-sequential", "rt");
    const second = await refreshUmbracoToken(env, "key-sequential", "rt");

    expect(first).toMatchObject({ ok: false, reason: "server_error" });
    expect(second).toMatchObject({ ok: true, accessToken: "second-access" });
    expect(postedRefreshTokens).toHaveLength(2);
  });
});

describe("refreshUmbracoToken with a refresh token that was rotated underneath it", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    postedRefreshTokens = [];
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it("retries once with the newer token KV picked up and succeeds", async () => {
    // Regression for #320: a concurrent refresh (or a KV read that hadn't caught
    // up yet) rotates the token, Umbraco says "already redeemed" for the copy we
    // posted, and the old code read that as a dead session.
    respondWith(
      json({ error: "invalid_grant" }, 400),
      json({ access_token: "fresh-access", refresh_token: "newest" }, 200)
    );
    const env = createEnv(createKv({ entries: [storedEntry("stale"), storedEntry("rotated")] }));

    const result = await refreshUmbracoToken(env, "key-rotated", "caller-snapshot");

    expect(result).toMatchObject({ ok: true, accessToken: "fresh-access" });
    expect(postedRefreshTokens).toEqual(["stale", "rotated"]);
  });

  it("returns expired without retrying when KV still holds the token just tried", async () => {
    respondWith(json({ error: "invalid_grant" }, 400));
    const env = createEnv(createKv({ entries: [storedEntry("same"), storedEntry("same")] }));

    const result = await refreshUmbracoToken(env, "key-same-token", "caller-snapshot");

    expect(result).toMatchObject({ ok: false, reason: "expired", error: "invalid_grant" });
    // Exactly one POST: there was nothing newer to try, and the retry is bounded
    // to a single extra attempt regardless.
    expect(postedRefreshTokens).toEqual(["same"]);
  });

  it("gives up after the single retry when the newer token is also rejected", async () => {
    respondWith(json({ error: "invalid_grant" }, 400));
    const env = createEnv(createKv({ entries: [storedEntry("stale"), storedEntry("rotated")] }));

    const result = await refreshUmbracoToken(env, "key-both-rejected", "caller-snapshot");

    expect(result).toMatchObject({ ok: false, reason: "expired" });
    expect(postedRefreshTokens).toEqual(["stale", "rotated"]);
  });

  it("falls back to the caller's token and logs when the KV read throws", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    respondWith(json({ access_token: "fresh-access" }, 200));
    const env = { ...createEnv(createKv({ getThrows: true })), LOG_AUTH: "true" } as HostedMcpEnv;

    const result = await refreshUmbracoToken(env, "key-kv-read-throws", "caller-snapshot");

    expect(result).toMatchObject({ ok: true, accessToken: "fresh-access" });
    expect(postedRefreshTokens).toEqual(["caller-snapshot"]);
    // Swallowing this silently is what let a stale snapshot masquerade as a
    // definitive `expired`.
    const lines = logSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(lines.some((line: string) => line.includes("KV READ FAILED"))).toBe(true);
    logSpy.mockRestore();
  });
});

describe("refreshUmbracoToken when the new tokens cannot be persisted", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    postedRefreshTokens = [];
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it("returns a server_error failure instead of rejecting", async () => {
    // Regression for #320: an unguarded KV write turned a successful refresh
    // into a rejected promise, breaking the discriminated-union contract.
    respondWith(json({ access_token: "fresh-access", refresh_token: "rotated" }, 200));
    const env = createEnv(createKv({ putThrows: true }));

    const result = await refreshUmbracoToken(env, "key-kv-write-throws", "rt");

    expect(result).toMatchObject({ ok: false, reason: "server_error" });
  });

  it("recovers using the cached rotated token instead of replaying a stale snapshot", async () => {
    // Regression: `storeUmbracoToken` throwing right after a successful token
    // exchange used to lose the rotated token entirely — KV never got it, so
    // the very next refresh replayed the caller's now-dead snapshot, got
    // `invalid_grant` with nothing newer in KV either, and reported a
    // definitive `expired` over what was really a one-time KV write blip.
    let putAttempts = 0;
    let stored: string | null = null;
    const kv = {
      get: async () => stored,
      put: async (_key: string, value: string) => {
        putAttempts += 1;
        if (putAttempts === 1) throw new Error("kv write quota exceeded");
        stored = value;
      },
      delete: async () => undefined,
    };
    const env = createEnv(kv as unknown as ReturnType<typeof createKv>);

    respondWith(
      json({ access_token: "access-1", refresh_token: "rotated-1" }, 200),
      json({ access_token: "access-2", refresh_token: "rotated-2" }, 200)
    );

    const first = await refreshUmbracoToken(env, "key-cache-recovery", "rt");
    expect(first).toMatchObject({ ok: false, reason: "server_error" });

    const second = await refreshUmbracoToken(env, "key-cache-recovery", "rt");

    // Posts the token from the failed-write rotation, not the caller's stale
    // "rt" snapshot (KV itself never got the first write, so a KV-only re-read
    // would have found nothing newer either).
    expect(postedRefreshTokens).toEqual(["rt", "rotated-1"]);
    expect(second).toMatchObject({ ok: true, accessToken: "access-2" });

    // The second call's persist succeeded, so its cache entry must be gone.
    // Prove it: have a third party write a different token straight to KV
    // (bypassing this module's own store path, standing in for an unrelated
    // write to the same key) and check the next call picks that up instead
    // of a leftover cached value shadowing it.
    stored = storedEntry("rotated-external");
    await refreshUmbracoToken(env, "key-cache-recovery", "some-other-snapshot");
    expect(postedRefreshTokens[2]).toEqual("rotated-external");
  });

  it("falls back to KV instead of replaying a cached token Umbraco has already rejected", async () => {
    // Regression: the `invalid_grant` retry used to check the cache before
    // KV, but the cache can only ever equal the token that was just posted —
    // so once populated, that lookup was always a no-op and could never fall
    // through to a genuinely newer token another isolate had persisted to KV
    // (the cross-isolate race `inFlightRefreshes` already documents as an
    // accepted limitation). That starved the retry of the one case it exists
    // for, turning a recoverable situation into a false `expired`.
    let putShouldThrow = true;
    let stored: string | null = null;
    const kv = {
      get: async () => stored,
      put: async (_key: string, value: string) => {
        if (putShouldThrow) throw new Error("kv write quota exceeded");
        stored = value;
      },
      delete: async () => undefined,
    };
    const env = createEnv(kv as unknown as ReturnType<typeof createKv>);

    respondWith(
      json({ access_token: "access-1", refresh_token: "cached-only" }, 200),
      json({ error: "invalid_grant" }, 400),
      json({ access_token: "access-2", refresh_token: "rotated-2" }, 200)
    );

    const first = await refreshUmbracoToken(env, "key-cross-isolate", "rt");
    expect(first).toMatchObject({ ok: false, reason: "server_error" });

    // Simulate another isolate persisting a genuinely newer token while this
    // isolate's cache still holds the one from its own failed write above.
    stored = storedEntry("kv-newer");
    putShouldThrow = false;

    const second = await refreshUmbracoToken(env, "key-cross-isolate", "rt");

    // Posts the stale cached token first, as before; on invalid_grant it must
    // fall through to KV's newer token rather than reporting `expired`.
    expect(postedRefreshTokens).toEqual(["rt", "cached-only", "kv-newer"]);
    expect(second).toMatchObject({ ok: true, accessToken: "access-2" });
  });

  it("keeps token material out of the failure message", async () => {
    respondWith(json({ access_token: "s3cr3t-access", refresh_token: "s3cr3t-refresh" }, 200));
    const env = createEnv(createKv({ putThrows: true }));

    const result = await refreshUmbracoToken(env, "key-kv-write-no-leak", "s3cr3t-caller");

    const message = (result as { message: string }).message;
    expect(message).not.toContain("s3cr3t-access");
    expect(message).not.toContain("s3cr3t-refresh");
    expect(message).not.toContain("s3cr3t-caller");
  });
});
