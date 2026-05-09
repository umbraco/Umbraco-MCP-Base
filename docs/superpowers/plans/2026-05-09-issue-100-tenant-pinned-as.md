# Tenant-Pinned `authorization_servers` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tenant-pinned OAuth discovery + per-tenant DCR for site-routed Workers, so non-RFC-8707 MCP clients (ChatGPT) can complete OAuth without sending `resource`, while preserving the existing RFC-8707 path and closing the confused-deputy door.

**Architecture:** Add a `tenant-oauth/` module that intercepts `/at/<alias>/{authorize,token,register,callback,.well-known/oauth-authorization-server}` before OAuthProvider sees them, validates the alias via existing siteRouting, enforces a per-tenant client binding (forward + reverse KV index), strips the prefix, injects/cross-validates the `resource` parameter, then forwards to OAuthProvider. Spec at `docs/superpowers/specs/2026-05-08-issue-100-tenant-pinned-as-design.md`.

**Tech Stack:** TypeScript ESM, Jest with `unstable_mockModule`, Cloudflare Workers, `@cloudflare/workers-oauth-provider`, `agents/mcp` (Wrangler virtual modules), Wrangler `unstable_dev` for integration tests.

**Quality gates after every step:**
- `npm run compile -w packages/hosted-mcp` — TypeScript
- `npm test -w packages/hosted-mcp` — unit tests
- `npm run test:integration -w packages/hosted-mcp` — Wrangler integration (after build)
- `gh pr checks <pr-number> --watch` after pushing

---

## File map

```
packages/hosted-mcp/src/
├── site-routing/internal/
│   ├── alias-context.ts                  [NEW]
│   └── __tests__/alias-context.test.ts   [NEW]
├── tenant-oauth/                         [NEW directory]
│   ├── resource-match.ts                 [NEW]
│   ├── binding-store.ts                  [NEW]
│   ├── tenant-router.ts                  [NEW]
│   └── __tests__/
│       ├── resource-match.test.ts        [NEW]
│       ├── binding-store.test.ts         [NEW]
│       └── tenant-router.test.ts         [NEW]
├── server/
│   ├── worker-entry.ts                   [MODIFIED]
│   └── __tests__/
│       └── tenant-discovery.test.ts      [NEW]
└── auth/
    ├── umbraco-handler.ts                [MODIFIED]
    └── __tests__/
        └── umbraco-handler.test.ts       [EXTENDED]

packages/hosted-mcp/tests/integration/
└── tenant-oauth-flow.test.ts             [NEW]
```

---

## Task 1: Shared alias-context helper

Extract the alias-resolution and canonical-resource logic into a shared module so `tenant-oauth/` can use it without reaching into `site-routing/`'s public surface.

**Files:**
- Create: `packages/hosted-mcp/src/site-routing/internal/alias-context.ts`
- Create: `packages/hosted-mcp/src/site-routing/internal/__tests__/alias-context.test.ts`

- [ ] **Step 1.1: Write failing test for `canonicalResourceForAlias`**

```typescript
// packages/hosted-mcp/src/site-routing/internal/__tests__/alias-context.test.ts
import { describe, it, expect } from "@jest/globals";
import { canonicalResourceForAlias } from "../alias-context.js";

describe("canonicalResourceForAlias", () => {
  it("returns origin + /at/<alias> with no trailing slash", () => {
    expect(canonicalResourceForAlias("https://worker.example.com", "demo"))
      .toBe("https://worker.example.com/at/demo");
  });

  it("strips a trailing slash from origin if accidentally provided", () => {
    expect(canonicalResourceForAlias("https://worker.example.com/", "demo"))
      .toBe("https://worker.example.com/at/demo");
  });

  it("does not URL-encode the alias (alias is opaque)", () => {
    expect(canonicalResourceForAlias("https://x", "abc-123_xyz"))
      .toBe("https://x/at/abc-123_xyz");
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=alias-context
```
Expected: FAIL with "Cannot find module '../alias-context.js'"

- [ ] **Step 1.3: Implement `canonicalResourceForAlias`**

```typescript
// packages/hosted-mcp/src/site-routing/internal/alias-context.ts
/**
 * Internal helpers shared between site-routing/ and tenant-oauth/.
 * Not part of the public package surface.
 */

import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";
import { buildPrefixRegex, extractSiteIdFromPath } from "../path-prefix.js";

/**
 * The canonical `resource` value for a tenant — `${origin}/at/<alias>` with
 * no trailing slash and no path suffix. This is the byte-equal target the
 * resource-match validator compares against.
 */
export function canonicalResourceForAlias(origin: string, alias: string): string {
  const trimmedOrigin = origin.replace(/\/+$/, "");
  return `${trimmedOrigin}/at/${alias}`;
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=alias-context
```
Expected: PASS (3 tests)

- [ ] **Step 1.5: Write failing test for `resolveAliasFromUrl`**

Append to `alias-context.test.ts`:

```typescript
import { resolveAliasFromUrl } from "../alias-context.js";
import type { HostedMcpEnv } from "../../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../../types/multi-site.js";
import { jest } from "@jest/globals";

describe("resolveAliasFromUrl", () => {
  const siteFixture: SiteConfig = {
    id: "demo",
    displayName: "Demo",
    baseUrl: "https://demo.example.com",
    oauthClientId: "demo-client",
  };
  const env = {} as HostedMcpEnv;

  function makeRouting(
    resolve: jest.Mock<(siteId: string, env: HostedMcpEnv) => Promise<SiteConfig | null>>,
    pathPrefix = "/at/:siteId"
  ): SiteRoutingConfig {
    return { pathPrefix, resolveSite: resolve };
  }

  it("returns alias and resolved site when the URL matches", async () => {
    const resolve = jest.fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>()
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
    const resolve = jest.fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockResolvedValue(null);
    const result = await resolveAliasFromUrl(
      new URL("https://worker.example.com/at/missing/authorize"),
      makeRouting(resolve),
      env
    );
    expect("rejected" in result && result.rejected.status).toBe(404);
  });

  it("returns rejected:502 when resolveSite throws", async () => {
    const resolve = jest.fn<(s: string, e: HostedMcpEnv) => Promise<SiteConfig | null>>()
      .mockRejectedValue(new Error("upstream"));
    const result = await resolveAliasFromUrl(
      new URL("https://worker.example.com/at/demo/authorize"),
      makeRouting(resolve),
      env
    );
    expect("rejected" in result && result.rejected.status).toBe(502);
  });
});
```

- [ ] **Step 1.6: Run test to verify it fails**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=alias-context
```
Expected: FAIL with "resolveAliasFromUrl is not a function"

- [ ] **Step 1.7: Implement `resolveAliasFromUrl`**

Append to `alias-context.ts`:

```typescript
/**
 * Result from resolving an alias out of a request URL.
 * - `{ alias, site }` — successfully matched and resolved
 * - `{ rejected: Response }` — the request should be returned to the caller as-is
 *   (404 unknown alias, 502 resolveSite threw)
 */
export type AliasResolution =
  | { alias: string; site: SiteConfig }
  | { rejected: Response };

/**
 * Match the URL's pathname against `siteRouting.pathPrefix` and resolve the
 * site. The match anchors at the start; trailing path segments after the alias
 * are allowed (e.g. `/at/<alias>/authorize` matches when prefix is `/at/:siteId`).
 *
 * Mirrors the existing siteRouter rejection semantics: 404 on null/no-match,
 * 502 on resolveSite throw.
 */
export async function resolveAliasFromUrl(
  url: URL,
  siteRouting: SiteRoutingConfig,
  env: HostedMcpEnv
): Promise<AliasResolution> {
  const aliasMatchRegex = buildAliasMatchRegex(siteRouting.pathPrefix);
  const match = url.pathname.match(aliasMatchRegex);
  const alias = match?.[1];

  if (!alias) {
    return {
      rejected: jsonResponse({ error: "not_found", path: url.pathname }, 404),
    };
  }

  let site: SiteConfig | null;
  try {
    site = await siteRouting.resolveSite(alias, env);
  } catch (err) {
    console.error(`siteRouting.resolveSite threw for "${alias}":`, err);
    return {
      rejected: jsonResponse(
        { error: "bad_gateway", message: "Failed to resolve site" },
        502
      ),
    };
  }

  if (!site) {
    return {
      rejected: jsonResponse({ error: "unknown_site", alias }, 404),
    };
  }

  return { alias, site };
}

/**
 * Build a regex that matches the pathPrefix (e.g. `/at/:siteId`) at the start
 * of a URL pathname, optionally followed by `/...` further segments. Captures
 * the alias.
 *
 * Differs from `buildPrefixRegex` (which anchors with `\/?$`, end-of-string).
 */
function buildAliasMatchRegex(pathPrefix: string): RegExp {
  // Reuse buildPrefixRegex to validate the pattern shape, then build our own
  // anchoring. buildPrefixRegex throws on bad shapes, which is what we want.
  buildPrefixRegex(pathPrefix);

  const escaped = pathPrefix
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/, "([^/]+)");
  return new RegExp(`^${escaped}(?:\\/|$)`);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 1.8: Run all tests to verify they pass**

```bash
npm run compile -w packages/hosted-mcp && npm test -w packages/hosted-mcp -- --testPathPattern=alias-context
```
Expected: PASS (7 tests total)

- [ ] **Step 1.9: Commit**

```bash
git add packages/hosted-mcp/src/site-routing/internal/
git commit -m "feat(hosted-mcp): shared alias-context helper for tenant-oauth and site-routing"
```

---

## Task 2: Resource match validator (strict equals)

A pure function that validates a client-sent `resource` parameter against the canonical PRM value.

**Files:**
- Create: `packages/hosted-mcp/src/tenant-oauth/resource-match.ts`
- Create: `packages/hosted-mcp/src/tenant-oauth/__tests__/resource-match.test.ts`

- [ ] **Step 2.1: Write failing tests**

```typescript
// packages/hosted-mcp/src/tenant-oauth/__tests__/resource-match.test.ts
import { describe, it, expect } from "@jest/globals";
import { validateResourceMatch } from "../resource-match.js";

describe("validateResourceMatch", () => {
  const canonical = "https://worker.example.com/at/demo";

  it("accepts byte-equal match", () => {
    expect(validateResourceMatch(canonical, canonical)).toEqual({ ok: true });
  });

  it("accepts when sent is undefined (synthesis path)", () => {
    expect(validateResourceMatch(undefined, canonical)).toEqual({ ok: true });
  });

  it("accepts when sent is empty string (treated as absent)", () => {
    expect(validateResourceMatch("", canonical)).toEqual({ ok: true });
  });

  it("accepts an array containing exactly the canonical value", () => {
    expect(validateResourceMatch([canonical], canonical)).toEqual({ ok: true });
  });

  it("rejects trailing-slash variant", () => {
    const r = validateResourceMatch(`${canonical}/`, canonical);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("does not match");
  });

  it("rejects /mcp suffix variant", () => {
    const r = validateResourceMatch(`${canonical}/mcp`, canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects different-tenant alias", () => {
    const r = validateResourceMatch("https://worker.example.com/at/other", canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects host mismatch", () => {
    const r = validateResourceMatch("https://attacker.example.com/at/demo", canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects scheme mismatch (http vs https)", () => {
    const r = validateResourceMatch("http://worker.example.com/at/demo", canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects array with multiple values, none equal to canonical", () => {
    const r = validateResourceMatch(
      ["https://worker.example.com/at/other", `${canonical}/x`],
      canonical
    );
    expect(r.ok).toBe(false);
  });

  it("accepts array where one value is exactly canonical (any match wins)", () => {
    expect(
      validateResourceMatch([`${canonical}/x`, canonical], canonical)
    ).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2.2: Run test to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=resource-match
```
Expected: FAIL — module not found

- [ ] **Step 2.3: Implement `validateResourceMatch`**

```typescript
// packages/hosted-mcp/src/tenant-oauth/resource-match.ts
/**
 * Strict-equality validation for the OAuth `resource` parameter against the
 * canonical PRM value (`${origin}/at/<alias>`).
 *
 * No normalisation: trailing slashes, path suffixes, scheme/host variants are
 * all rejected. Clients that walk PRM correctly send the canonical form;
 * variants signal a confused or malicious client.
 *
 * `undefined` and `""` are treated as "absent" — the caller synthesises the
 * canonical value and the issued token's `aud` is set correctly without the
 * client having to send anything. Returning `{ok:true}` on absent simplifies
 * the call site (one branch for valid, one for invalid).
 */
export type ResourceMatchResult = { ok: true } | { ok: false; reason: string };

export function validateResourceMatch(
  sent: string | string[] | undefined,
  canonical: string
): ResourceMatchResult {
  if (sent === undefined || sent === "") {
    return { ok: true };
  }
  const values = Array.isArray(sent) ? sent : [sent];
  for (const v of values) {
    if (v === canonical) return { ok: true };
  }
  return {
    ok: false,
    reason: `resource parameter does not match site URL (expected exactly "${canonical}")`,
  };
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=resource-match
```
Expected: PASS (11 tests)

- [ ] **Step 2.5: Commit**

```bash
git add packages/hosted-mcp/src/tenant-oauth/resource-match.ts packages/hosted-mcp/src/tenant-oauth/__tests__/resource-match.test.ts
git commit -m "feat(hosted-mcp): strict-equals resource match validator"
```

---

## Task 3: Binding store (forward + reverse index)

The KV layer for per-tenant DCR. Forward index `at:<alias>:client:<id>` is checked at `/at/<alias>/authorize`; reverse index `client:<id>:tenant` is checked at root `/authorize` for confused-deputy defence.

**Files:**
- Create: `packages/hosted-mcp/src/tenant-oauth/binding-store.ts`
- Create: `packages/hosted-mcp/src/tenant-oauth/__tests__/binding-store.test.ts`

- [ ] **Step 3.1: Write failing tests**

```typescript
// packages/hosted-mcp/src/tenant-oauth/__tests__/binding-store.test.ts
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  putClientBinding,
  hasClientBinding,
  getClientTenant,
  revokeClient,
} from "../binding-store.js";

function createMockKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    put: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

describe("binding-store", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  describe("putClientBinding", () => {
    it("writes both forward and reverse keys", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(kv.store.has("at:tenant-a:client:client-123")).toBe(true);
      expect(kv.store.get("client:client-123:tenant")).toBe("tenant-a");
    });

    it("forward record contains a creation timestamp", async () => {
      const before = Date.now();
      await putClientBinding(kv as any, "tenant-a", "client-123");
      const fwd = JSON.parse(kv.store.get("at:tenant-a:client:client-123")!);
      expect(fwd.createdAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("hasClientBinding", () => {
    it("returns true when forward key exists", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(await hasClientBinding(kv as any, "tenant-a", "client-123")).toBe(true);
    });

    it("returns false when client is bound to a different tenant", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(await hasClientBinding(kv as any, "tenant-b", "client-123")).toBe(false);
    });

    it("returns false for unknown client_id", async () => {
      expect(await hasClientBinding(kv as any, "tenant-a", "unknown")).toBe(false);
    });
  });

  describe("getClientTenant", () => {
    it("returns the alias the client is bound to", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(await getClientTenant(kv as any, "client-123")).toBe("tenant-a");
    });

    it("returns null for unbound client", async () => {
      expect(await getClientTenant(kv as any, "unbound")).toBeNull();
    });
  });

  describe("revokeClient", () => {
    it("removes both forward and reverse keys", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      await revokeClient(kv as any, "client-123");
      expect(kv.store.has("at:tenant-a:client:client-123")).toBe(false);
      expect(kv.store.has("client:client-123:tenant")).toBe(false);
    });

    it("is a no-op when client is not bound (no throw)", async () => {
      await expect(revokeClient(kv as any, "unknown")).resolves.toBeUndefined();
    });
  });

  describe("isolation", () => {
    it("binding for tenant A does not leak to tenant B", async () => {
      await putClientBinding(kv as any, "a", "shared-id");
      expect(await hasClientBinding(kv as any, "a", "shared-id")).toBe(true);
      expect(await hasClientBinding(kv as any, "b", "shared-id")).toBe(false);
    });
  });
});
```

- [ ] **Step 3.2: Run tests to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=binding-store
```
Expected: FAIL — module not found

- [ ] **Step 3.3: Implement binding store**

```typescript
// packages/hosted-mcp/src/tenant-oauth/binding-store.ts
/**
 * Per-tenant client-id binding store.
 *
 * Two records per registration, both written at `/at/<alias>/register`:
 *
 *   at:<alias>:client:<client_id>   forward index — "is this client allowed at this tenant?"
 *   client:<client_id>:tenant       reverse index — "which tenant is this client registered for?"
 *
 * Forward feeds /at/<alias>/authorize and /at/<alias>/token.
 * Reverse feeds root /authorize confused-deputy defence under siteRouting.
 *
 * Both are load-bearing for security — without the reverse index, an attacker
 * who registered a client_id at /at/A/register could authorise for tenant B
 * via root /authorize?resource=${origin}/at/B&client_id=<their A client>.
 */

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const FORWARD_PREFIX = "at:";
const REVERSE_PREFIX = "client:";

function forwardKey(alias: string, clientId: string): string {
  return `${FORWARD_PREFIX}${alias}:client:${clientId}`;
}

function reverseKey(clientId: string): string {
  return `${REVERSE_PREFIX}${clientId}:tenant`;
}

interface ForwardRecord {
  createdAt: number;
}

/**
 * Write the binding pair atomically. KV doesn't expose multi-key
 * transactions — we write forward then reverse. If the second write fails the
 * forward record is orphaned but harmless (extra row, no security impact).
 */
export async function putClientBinding(
  kv: KVNamespaceLike,
  alias: string,
  clientId: string
): Promise<void> {
  const record: ForwardRecord = { createdAt: Date.now() };
  await kv.put(forwardKey(alias, clientId), JSON.stringify(record));
  await kv.put(reverseKey(clientId), alias);
}

/**
 * Forward lookup — does this client have a binding for this specific tenant?
 */
export async function hasClientBinding(
  kv: KVNamespaceLike,
  alias: string,
  clientId: string
): Promise<boolean> {
  const value = await kv.get(forwardKey(alias, clientId));
  return value !== null;
}

/**
 * Reverse lookup — which tenant did this client register for?
 * Returns null when the client_id was never bound (e.g. registered at root
 * `/register` without siteRouting, or a fabricated client_id).
 */
export async function getClientTenant(
  kv: KVNamespaceLike,
  clientId: string
): Promise<string | null> {
  return kv.get(reverseKey(clientId));
}

/**
 * Delete both forward and reverse keys. Looks up the alias via reverse first
 * so the forward key path is exact. No-op when the client is not bound.
 */
export async function revokeClient(
  kv: KVNamespaceLike,
  clientId: string
): Promise<void> {
  const alias = await kv.get(reverseKey(clientId));
  if (!alias) return;
  await kv.delete(forwardKey(alias, clientId));
  await kv.delete(reverseKey(clientId));
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=binding-store
```
Expected: PASS (10 tests)

- [ ] **Step 3.5: Commit**

```bash
git add packages/hosted-mcp/src/tenant-oauth/binding-store.ts packages/hosted-mcp/src/tenant-oauth/__tests__/binding-store.test.ts
git commit -m "feat(hosted-mcp): per-tenant client binding store with forward+reverse index"
```

---

## Task 4: Tenant AS metadata renderer + path matcher

Pure functions that produce the RFC 8414 doc and recognise tenant-OAuth paths.

**Files:**
- Create: `packages/hosted-mcp/src/tenant-oauth/tenant-router.ts` (start; dispatch comes in Task 5)
- Create: `packages/hosted-mcp/src/tenant-oauth/__tests__/tenant-router.test.ts`

- [ ] **Step 4.1: Write failing tests for `renderTenantAuthorizationServerMetadata`**

```typescript
// packages/hosted-mcp/src/tenant-oauth/__tests__/tenant-router.test.ts
import { describe, it, expect } from "@jest/globals";
import {
  renderTenantAuthorizationServerMetadata,
  matchTenantOAuthPath,
} from "../tenant-router.js";

describe("renderTenantAuthorizationServerMetadata", () => {
  it("returns RFC 8414 metadata with tenant-prefixed endpoints", async () => {
    const request = new Request("https://worker.example.com/.well-known/oauth-authorization-server/at/demo");
    const response = renderTenantAuthorizationServerMetadata(
      "https://worker.example.com",
      "demo",
      request
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.issuer).toBe("https://worker.example.com/at/demo");
    expect(body.authorization_endpoint).toBe("https://worker.example.com/at/demo/authorize");
    expect(body.token_endpoint).toBe("https://worker.example.com/at/demo/token");
    expect(body.registration_endpoint).toBe("https://worker.example.com/at/demo/register");
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.code_challenge_methods_supported).toContain("S256");
  });

  it("returns CORS-safe headers", async () => {
    const request = new Request("https://worker.example.com/.well-known/oauth-authorization-server/at/demo");
    const response = renderTenantAuthorizationServerMetadata("https://worker.example.com", "demo", request);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("returns 204 + CORS preflight on OPTIONS", () => {
    const request = new Request(
      "https://worker.example.com/.well-known/oauth-authorization-server/at/demo",
      { method: "OPTIONS" }
    );
    const response = renderTenantAuthorizationServerMetadata("https://worker.example.com", "demo", request);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
  });
});

describe("matchTenantOAuthPath", () => {
  const prefixRegex = /^\/at\/([^/]+)/;

  it.each([
    ["/at/demo/authorize", "authorize", "demo"],
    ["/at/demo/token", "token", "demo"],
    ["/at/demo/register", "register", "demo"],
    ["/at/demo/callback", "callback", "demo"],
    ["/at/demo/.well-known/oauth-authorization-server", "as-metadata", "demo"],
    ["/.well-known/oauth-authorization-server/at/demo", "as-metadata", "demo"],
    ["/.well-known/oauth-protected-resource/at/demo", "prm", "demo"],
  ])("matches %s as kind=%s alias=%s", (path, kind, alias) => {
    const match = matchTenantOAuthPath(path);
    expect(match).not.toBeNull();
    expect(match!.kind).toBe(kind);
    expect(match!.alias).toBe(alias);
  });

  it.each([
    "/at/demo/mcp",                  // MCP endpoint — handled by siteRouter, not tenant-router
    "/mcp",                          // root MCP
    "/authorize",                    // root authorize
    "/at/",                          // empty alias
    "/at/demo",                      // bare tenant — no operation
    "/random/path",
  ])("does not match %s", (path) => {
    expect(matchTenantOAuthPath(path)).toBeNull();
  });

  it("preserves trailing slashes (matches /at/demo/authorize/)", () => {
    expect(matchTenantOAuthPath("/at/demo/authorize/")).toEqual({
      kind: "authorize",
      alias: "demo",
    });
  });
});
```

- [ ] **Step 4.2: Run test to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=tenant-router
```
Expected: FAIL — module not found

- [ ] **Step 4.3: Implement `renderTenantAuthorizationServerMetadata` and `matchTenantOAuthPath`**

```typescript
// packages/hosted-mcp/src/tenant-oauth/tenant-router.ts
/**
 * Tenant-prefixed OAuth router.
 *
 * Intercepts requests to /at/<alias>/{authorize,token,register,callback,
 * .well-known/oauth-authorization-server} and the per-tenant PRM at
 * /.well-known/oauth-protected-resource/at/<alias>, before they reach
 * OAuthProvider. Validates the alias, enforces the per-tenant client binding,
 * synthesises/cross-validates `resource`, then strips the prefix and forwards
 * to OAuthProvider's root handlers.
 *
 * Companion to site-routing/site-router.ts, which handles /at/<alias>/mcp.
 */

export type TenantOAuthKind =
  | "authorize"
  | "token"
  | "register"
  | "callback"
  | "as-metadata"
  | "prm";

export interface TenantOAuthMatch {
  kind: TenantOAuthKind;
  alias: string;
}

const SUFFIX_PATHS: ReadonlyArray<{ kind: TenantOAuthKind; suffix: string }> = [
  { kind: "authorize", suffix: "authorize" },
  { kind: "token", suffix: "token" },
  { kind: "register", suffix: "register" },
  { kind: "callback", suffix: "callback" },
  { kind: "as-metadata", suffix: ".well-known/oauth-authorization-server" },
];

const RFC_8414_AS_METADATA_REGEX =
  /^\/\.well-known\/oauth-authorization-server\/at\/([^/]+)\/?$/;
const PRM_REGEX =
  /^\/\.well-known\/oauth-protected-resource\/at\/([^/]+)\/?$/;
const TENANT_OP_REGEX =
  /^\/at\/([^/]+)\/(authorize|token|register|callback|\.well-known\/oauth-authorization-server)\/?$/;

/**
 * Recognise a tenant-OAuth path and extract its kind + alias. Does NOT match
 * /at/<alias>/mcp — that's handled by site-router. Does NOT match the bare
 * /at/<alias>/ — that's the MCP endpoint without a sub-path.
 */
export function matchTenantOAuthPath(pathname: string): TenantOAuthMatch | null {
  const m1 = pathname.match(RFC_8414_AS_METADATA_REGEX);
  if (m1) return { kind: "as-metadata", alias: m1[1] };

  const m2 = pathname.match(PRM_REGEX);
  if (m2) return { kind: "prm", alias: m2[1] };

  const m3 = pathname.match(TENANT_OP_REGEX);
  if (m3) {
    const alias = m3[1];
    const op = m3[2];
    if (op === ".well-known/oauth-authorization-server") {
      return { kind: "as-metadata", alias };
    }
    return { kind: op as TenantOAuthKind, alias };
  }

  return null;
}

/**
 * RFC 8414 authorization-server metadata for a single tenant. All endpoints
 * are tenant-prefixed; clients that walk this doc never lose the alias.
 */
export function renderTenantAuthorizationServerMetadata(
  origin: string,
  alias: string,
  request: Request
): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  const tenantBase = `${origin}/at/${alias}`;
  const body = {
    issuer: tenantBase,
    authorization_endpoint: `${tenantBase}/authorize`,
    token_endpoint: `${tenantBase}/token`,
    registration_endpoint: `${tenantBase}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["openid", "offline_access"],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=tenant-router
```
Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add packages/hosted-mcp/src/tenant-oauth/tenant-router.ts packages/hosted-mcp/src/tenant-oauth/__tests__/tenant-router.test.ts
git commit -m "feat(hosted-mcp): tenant-OAuth path matcher and AS metadata renderer"
```

---

## Task 5: Tenant dispatch — alias check, binding check, prefix strip, forward

The core logic. This is the longest task; broken into incremental sub-tasks each with their own test.

**Files:**
- Modify: `packages/hosted-mcp/src/tenant-oauth/tenant-router.ts`
- Modify: `packages/hosted-mcp/src/tenant-oauth/__tests__/tenant-router.test.ts`

- [ ] **Step 5.1: Write failing test for `dispatchTenantOAuth` — register flow writes bindings**

Append to `tenant-router.test.ts`:

```typescript
import { jest } from "@jest/globals";
import { dispatchTenantOAuth } from "../tenant-router.js";
import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";

function createMockKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: jest.fn(async (k: string) => { store.delete(k); }),
  };
}

const siteFixture: SiteConfig = {
  id: "demo",
  displayName: "Demo",
  baseUrl: "https://demo.example.com",
  oauthClientId: "demo-client",
};

function makeRouting(): SiteRoutingConfig {
  return {
    pathPrefix: "/at/:siteId",
    resolveSite: jest.fn(async () => siteFixture),
  };
}

function makeEnv(kv: any): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://demo.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: kv,
    MCP_AGENT: {} as any,
    OAUTH_PROVIDER: {} as any,
  };
}

const ctx = {} as ExecutionContext;

describe("dispatchTenantOAuth — register", () => {
  it("forwards /at/<alias>/register to OAuthProvider's /register and writes bindings on success", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn(async (req: Request) => {
      // Verify prefix was stripped
      expect(new URL(req.url).pathname).toBe("/register");
      return new Response(
        JSON.stringify({ client_id: "issued-client-1", client_secret: null }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    });

    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "demo" },
      new Request("https://worker.example.com/at/demo/register", {
        method: "POST",
        body: JSON.stringify({ redirect_uris: ["https://worker.example.com/at/demo/callback"] }),
        headers: { "content-type": "application/json" },
      }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as any }
    );

    expect(response.status).toBe(201);
    expect(kv.store.has("at:demo:client:issued-client-1")).toBe(true);
    expect(kv.store.get("client:issued-client-1:tenant")).toBe("demo");
  });

  it("does NOT write bindings when OAuthProvider rejects the registration", async () => {
    const kv = createMockKV();
    const oauthFetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_client_metadata" }), { status: 400 })
    );
    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "demo" },
      new Request("https://worker.example.com/at/demo/register", { method: "POST" }),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as any }
    );
    expect(response.status).toBe(400);
    expect(kv.store.size).toBe(0);
  });

  it("returns 404 when alias is unknown", async () => {
    const kv = createMockKV();
    const routing: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: async () => null,
    };
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "register", alias: "missing" },
      new Request("https://worker.example.com/at/missing/register", { method: "POST" }),
      makeEnv(kv),
      ctx,
      routing,
      { fetch: oauthFetch as any }
    );
    expect(response.status).toBe(404);
    expect(oauthFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Run test to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=tenant-router
```
Expected: FAIL — `dispatchTenantOAuth is not a function`

- [ ] **Step 5.3: Implement dispatch — register branch**

Append to `tenant-router.ts`:

```typescript
import type { HostedMcpEnv } from "../types/env.js";
import type { SiteRoutingConfig } from "../types/multi-site.js";
import { resolveAliasFromUrl, canonicalResourceForAlias } from "../site-routing/internal/alias-context.js";
import { putClientBinding, hasClientBinding } from "./binding-store.js";
import { validateResourceMatch } from "./resource-match.js";

interface OAuthProviderLike {
  fetch(request: Request, env: HostedMcpEnv, ctx: ExecutionContext): Promise<Response>;
}

/**
 * Dispatch a tenant-OAuth request: validate alias, enforce binding (where
 * relevant), strip the /at/<alias>/ prefix, and forward to OAuthProvider.
 *
 * `as-metadata` and `prm` are rendered locally (no OAuthProvider involvement).
 * `register` writes binding records on success. `authorize` and `token` check
 * the forward binding and reject 400 invalid_client on miss.
 */
export async function dispatchTenantOAuth(
  match: TenantOAuthMatch,
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext,
  siteRouting: SiteRoutingConfig,
  oauthProvider: OAuthProviderLike
): Promise<Response> {
  const url = new URL(request.url);

  // PRM and AS metadata are public (no alias resolution needed for AS metadata
  // beyond the path match, but we still validate alias exists so unknown
  // tenants get a clean 404 here too).
  if (match.kind === "as-metadata") {
    const resolution = await resolveAliasFromUrl(
      // Synthesise an URL with /at/<alias>/ so resolveAliasFromUrl matches.
      new URL(`/at/${match.alias}/`, url.origin),
      siteRouting,
      env
    );
    if ("rejected" in resolution) return resolution.rejected;
    return renderTenantAuthorizationServerMetadata(url.origin, match.alias, request);
  }

  if (match.kind === "prm") {
    const resolution = await resolveAliasFromUrl(
      new URL(`/at/${match.alias}/`, url.origin),
      siteRouting,
      env
    );
    if ("rejected" in resolution) return resolution.rejected;
    return renderProtectedResourceMetadataForTenant(url.origin, match.alias, request);
  }

  // For authorize/token/register/callback — alias must resolve to a real site.
  const resolution = await resolveAliasFromUrl(
    new URL(`/at/${match.alias}/`, url.origin),
    siteRouting,
    env
  );
  if ("rejected" in resolution) return resolution.rejected;

  if (match.kind === "register") {
    return dispatchRegister(match.alias, request, env, ctx, oauthProvider);
  }

  // callback: pass through to OAuthProvider with prefix intact (the existing
  // callback handler already accepts /callback/:siteId; /at/<alias>/callback
  // is conceptually the same shape and the prefix-router routes accordingly
  // via worker-entry — see Task 8).
  if (match.kind === "callback") {
    return oauthProvider.fetch(request, env, ctx);
  }

  // authorize and token: binding check then forward (Step 5.4+ implements these)
  throw new Error(`dispatchTenantOAuth: kind=${match.kind} not implemented`);
}

async function dispatchRegister(
  alias: string,
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext,
  oauthProvider: OAuthProviderLike
): Promise<Response> {
  const url = new URL(request.url);
  const stripped = new URL("/register", url.origin);
  // Preserve query string if any (registration responses don't typically use one)
  stripped.search = url.search;

  const forwarded = new Request(stripped.toString(), request);
  const response = await oauthProvider.fetch(forwarded, env, ctx);

  // Only persist bindings on a 2xx response — DCR errors must not create
  // orphan binding records.
  if (response.status < 200 || response.status >= 300) {
    return response;
  }

  // Clone the response so we can read the body for the client_id, then return
  // an identical response to the caller.
  const cloned = response.clone();
  let parsed: { client_id?: unknown } = {};
  try {
    parsed = (await cloned.json()) as { client_id?: unknown };
  } catch {
    // Non-JSON body — nothing to bind. Return as-is.
    return response;
  }

  const clientId = typeof parsed.client_id === "string" ? parsed.client_id : null;
  if (!clientId) return response;

  await putClientBinding(env.OAUTH_KV, alias, clientId);
  return response;
}

/**
 * Per-tenant PRM (RFC 9728), with `authorization_servers` pinned to the
 * tenant URL so non-RFC-8707 clients walk the per-tenant AS metadata.
 */
function renderProtectedResourceMetadataForTenant(
  origin: string,
  alias: string,
  request: Request
): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  const tenantBase = `${origin}/at/${alias}`;
  return new Response(
    JSON.stringify({
      resource: tenantBase,
      authorization_servers: [tenantBase],
      bearer_methods_supported: ["header"],
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
```

- [ ] **Step 5.4: Run register tests to verify pass**

```bash
npm run compile -w packages/hosted-mcp && npm test -w packages/hosted-mcp -- --testPathPattern=tenant-router
```
Expected: PASS for register tests; the kind=authorize/token tests will fail in later steps but those tests don't exist yet.

- [ ] **Step 5.5: Write failing test for authorize dispatch**

Append to `tenant-router.test.ts`:

```typescript
describe("dispatchTenantOAuth — authorize", () => {
  it("rejects 400 invalid_client when no binding exists", async () => {
    const kv = createMockKV();
    // No binding for unbound-client
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request("https://worker.example.com/at/demo/authorize?client_id=unbound-client&redirect_uri=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo%2Fcallback&response_type=code"),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as any }
    );
    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error).toBe("invalid_client");
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("rejects 400 invalid_client when binding exists for a different tenant", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as any, "other-tenant", "client-1");
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request("https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code"),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as any }
    );
    expect(response.status).toBe(400);
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("forwards to OAuthProvider with stripped path and synthesised resource when binding matches and no resource sent", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as any, "demo", "client-1");
    const oauthFetch = jest.fn(async (req: Request) => {
      const u = new URL(req.url);
      expect(u.pathname).toBe("/authorize");
      // Synthesised resource present
      expect(u.searchParams.get("resource")).toBe("https://worker.example.com/at/demo");
      // Original params preserved
      expect(u.searchParams.get("client_id")).toBe("client-1");
      // Redirect_uri NOT stripped — preserves prefixed form
      expect(u.searchParams.get("redirect_uri")).toBe("https://worker.example.com/at/demo/callback");
      return new Response("ok", { status: 200 });
    });

    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request("https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&redirect_uri=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo%2Fcallback"),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as any }
    );
    expect(response.status).toBe(200);
    expect(oauthFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects 400 invalid_request when sent resource does not byte-equal canonical", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as any, "demo", "client-1");
    const oauthFetch = jest.fn();
    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request("https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo%2F"),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as any }
    );
    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error).toBe("invalid_request");
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("forwards unchanged when sent resource matches canonical exactly", async () => {
    const kv = createMockKV();
    await putClientBinding(kv as any, "demo", "client-1");
    const oauthFetch = jest.fn(async (req: Request) => {
      const u = new URL(req.url);
      // Sent resource preserved as-is
      expect(u.searchParams.get("resource")).toBe("https://worker.example.com/at/demo");
      return new Response("ok", { status: 200 });
    });

    const response = await dispatchTenantOAuth(
      { kind: "authorize", alias: "demo" },
      new Request("https://worker.example.com/at/demo/authorize?client_id=client-1&response_type=code&resource=https%3A%2F%2Fworker.example.com%2Fat%2Fdemo"),
      makeEnv(kv),
      ctx,
      makeRouting(),
      { fetch: oauthFetch as any }
    );
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 5.6: Run authorize tests to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=tenant-router
```
Expected: FAIL with the "not implemented" throw

- [ ] **Step 5.7: Implement authorize and token dispatch**

In `tenant-router.ts`, replace the `throw new Error("dispatchTenantOAuth: kind=...")` line with:

```typescript
  if (match.kind === "authorize" || match.kind === "token") {
    return dispatchAuthorizeOrToken(match.kind, match.alias, request, env, ctx, oauthProvider);
  }

  // Unreachable — match.kind is exhaustive
  throw new Error(`dispatchTenantOAuth: unhandled kind=${(match as any).kind}`);
}

async function dispatchAuthorizeOrToken(
  kind: "authorize" | "token",
  alias: string,
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext,
  oauthProvider: OAuthProviderLike
): Promise<Response> {
  const url = new URL(request.url);
  const canonical = canonicalResourceForAlias(url.origin, alias);

  // Read client_id from query (authorize GET) or form body (authorize POST,
  // token POST). For POST we must clone request before the body is consumed
  // by OAuthProvider downstream.
  const { clientId, sentResource, formClone } = await readClientIdAndResource(request);
  if (!clientId) {
    return jsonError(400, "invalid_request", "client_id is required");
  }

  // Forward-index binding check.
  if (!(await hasClientBinding(env.OAUTH_KV, alias, clientId))) {
    return jsonError(400, "invalid_client", "Client not registered for this site");
  }

  // Resource cross-validation against canonical PRM value (strict equals).
  const validation = validateResourceMatch(sentResource, canonical);
  if (!validation.ok) {
    return jsonError(400, "invalid_request", validation.reason);
  }

  // Strip prefix; synthesise resource when absent. For authorize (GET/POST)
  // the resource is a query parameter; for token (POST form) it's in the
  // body. We rebuild the request accordingly.
  const stripped = new URL(`/${kind}`, url.origin);
  for (const [k, v] of url.searchParams) stripped.searchParams.append(k, v);
  if (sentResource === undefined || sentResource === "") {
    stripped.searchParams.set("resource", canonical);
  }

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    if (formClone !== null) {
      // Re-serialise the form, injecting `resource` if synthesised.
      if (sentResource === undefined || sentResource === "") {
        formClone.set("resource", canonical);
      }
      init.body = formClone;
    } else {
      // Non-form body (e.g. JSON for /register-shaped tokens — rare). Pass
      // through using the request body stream.
      init.body = request.body;
      (init as any).duplex = "half";
    }
  }

  const forwarded = new Request(stripped.toString(), init);
  return oauthProvider.fetch(forwarded, env, ctx);
}

interface ParsedRequest {
  clientId: string | null;
  sentResource: string | string[] | undefined;
  formClone: URLSearchParams | null; // null when not a form submission
}

async function readClientIdAndResource(request: Request): Promise<ParsedRequest> {
  const url = new URL(request.url);
  const queryClientId = url.searchParams.get("client_id");
  const queryResource = url.searchParams.getAll("resource");

  if (request.method === "GET" || request.method === "HEAD") {
    return {
      clientId: queryClientId,
      sentResource: queryResource.length === 0
        ? undefined
        : queryResource.length === 1 ? queryResource[0] : queryResource,
      formClone: null,
    };
  }

  // POST: try form parse. Clone first so the original request body is not
  // consumed (we may forward it).
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.clone().text();
    const form = new URLSearchParams(text);
    const formResource = form.getAll("resource");
    return {
      clientId: form.get("client_id") ?? queryClientId,
      sentResource: formResource.length === 0
        ? (queryResource.length === 0
            ? undefined
            : queryResource.length === 1 ? queryResource[0] : queryResource)
        : formResource.length === 1 ? formResource[0] : formResource,
      formClone: form,
    };
  }

  // Non-form POST — pull client_id from query only.
  return {
    clientId: queryClientId,
    sentResource: queryResource.length === 0
      ? undefined
      : queryResource.length === 1 ? queryResource[0] : queryResource,
    formClone: null,
  };
}

function jsonError(status: number, error: string, error_description: string): Response {
  return new Response(
    JSON.stringify({ error, error_description }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}
```

- [ ] **Step 5.8: Run all tenant-router tests to verify pass**

```bash
npm run compile -w packages/hosted-mcp && npm test -w packages/hosted-mcp -- --testPathPattern=tenant-router
```
Expected: PASS

- [ ] **Step 5.9: Commit**

```bash
git add packages/hosted-mcp/src/tenant-oauth/tenant-router.ts packages/hosted-mcp/src/tenant-oauth/__tests__/tenant-router.test.ts
git commit -m "feat(hosted-mcp): tenant-OAuth dispatcher with binding check + resource synthesis"
```

---

## Task 6: Tenant-pinned PRM in worker-entry

The legacy PRM handler at `worker-entry.ts:533` emits root `authorization_servers`. Flip it to the tenant-pinned form.

**Files:**
- Modify: `packages/hosted-mcp/src/server/worker-entry.ts`
- Modify: `packages/hosted-mcp/src/server/__tests__/cloud-routing-gate.test.ts` (add new assertion)

- [ ] **Step 6.1: Write failing test that PRM emits tenant-pinned `authorization_servers`**

Append to `cloud-routing-gate.test.ts`:

```typescript
describe("PRM with siteRouting on", () => {
  it("emits authorization_servers pointing at the tenant URL, not the worker root", async () => {
    const oauth = makeOauthProvider();
    const handler = createWorkerExport(oauth, {
      ...baseOptions,
      siteRouting: makeSiteRouting(),
    });

    const response = await handler.fetch(
      new Request("https://worker.example.com/.well-known/oauth-protected-resource/at/abc"),
      makeEnv(),
      {} as ExecutionContext
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.resource).toBe("https://worker.example.com/at/abc");
    expect(body.authorization_servers).toEqual(["https://worker.example.com/at/abc"]);
  });
});
```

- [ ] **Step 6.2: Run test to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=cloud-routing-gate
```
Expected: FAIL — `authorization_servers` is `["https://worker.example.com"]`

- [ ] **Step 6.3: Update `renderProtectedResourceMetadata` in `worker-entry.ts`**

Locate `function renderProtectedResourceMetadata` (around line 533) and replace the body builder:

```typescript
function renderProtectedResourceMetadata(
  request: Request,
  url: URL,
  resourcePath: string,
): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  const issuer = `${url.protocol}//${url.host}`;
  const tenantUrl = `${issuer}${resourcePath}`;
  return new Response(
    JSON.stringify({
      resource: tenantUrl,
      // Tenant-pinned per issue #100 — clients walk per-tenant AS metadata
      // and never lose the alias.
      authorization_servers: [tenantUrl],
      bearer_methods_supported: ["header"],
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
```

- [ ] **Step 6.4: Run test to verify pass**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=cloud-routing-gate
```
Expected: PASS

- [ ] **Step 6.5: Commit**

```bash
git add packages/hosted-mcp/src/server/worker-entry.ts packages/hosted-mcp/src/server/__tests__/cloud-routing-gate.test.ts
git commit -m "feat(hosted-mcp): tenant-pinned authorization_servers in PRM"
```

---

## Task 7: Wire tenant-oauth dispatcher into `createWorkerExport`

Recognise tenant-OAuth paths BEFORE the existing siteRouter, and disable root `/register` under siteRouting.

**Files:**
- Modify: `packages/hosted-mcp/src/server/worker-entry.ts`
- Create: `packages/hosted-mcp/src/server/__tests__/tenant-discovery.test.ts`

- [ ] **Step 7.1: Write failing test for tenant-OAuth dispatch order**

```typescript
// packages/hosted-mcp/src/server/__tests__/tenant-discovery.test.ts
import { describe, it, expect, jest } from "@jest/globals";
import { createWorkerExport, type HostedMcpServerOptions } from "../worker-entry.js";
import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";

const baseOptions: HostedMcpServerOptions = {
  name: "test-mcp",
  version: "0.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

const siteFixture: SiteConfig = {
  id: "abc",
  displayName: "abc",
  baseUrl: "https://abc.example.com",
  oauthClientId: "test-client",
};

function makeRouting(): SiteRoutingConfig {
  return {
    pathPrefix: "/at/:siteId",
    resolveSite: async () => siteFixture,
  };
}

function makeEnv(): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://single.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    } as any,
    MCP_AGENT: {} as any,
    OAUTH_PROVIDER: {} as any,
  };
}

const ctx = {} as ExecutionContext;

describe("createWorkerExport — tenant-OAuth dispatch", () => {
  it("serves tenant AS metadata at /.well-known/oauth-authorization-server/at/<alias>", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as any, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/.well-known/oauth-authorization-server/at/abc"),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.issuer).toBe("https://worker.example.com/at/abc");
    expect(body.authorization_endpoint).toBe("https://worker.example.com/at/abc/authorize");
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("returns 404 root /register when siteRouting gate is on", async () => {
    const oauth = { fetch: jest.fn() };
    const handler = createWorkerExport(oauth as any, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/register", { method: "POST" }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(404);
    const body = await response.json() as any;
    expect(body.error).toBe("registration_disabled");
    expect(oauth.fetch).not.toHaveBeenCalled();
  });

  it("DOES NOT 404 root /register when siteRouting gate returns false", async () => {
    const oauth = { fetch: jest.fn(async () => new Response("ok", { status: 200 })) };
    const handler = createWorkerExport(oauth as any, {
      ...baseOptions,
      siteRouting: { ...makeRouting(), enabled: () => false },
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/register", { method: "POST" }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    expect(oauth.fetch).toHaveBeenCalled();
  });

  it("DOES NOT 404 root /register when siteRouting is undefined", async () => {
    const oauth = { fetch: jest.fn(async () => new Response("ok", { status: 200 })) };
    const handler = createWorkerExport(oauth as any, baseOptions);
    const response = await handler.fetch(
      new Request("https://worker.example.com/register", { method: "POST" }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
  });

  it("/at/<alias>/mcp continues to flow through siteRouter to OAuthProvider unchanged", async () => {
    const oauth = {
      fetch: jest.fn(async (req: Request) => {
        // Path preserved for OAuthProvider's audience check
        expect(new URL(req.url).pathname).toBe("/at/abc/mcp");
        return new Response("oauth", { status: 200 });
      }),
    };
    const handler = createWorkerExport(oauth as any, {
      ...baseOptions,
      siteRouting: makeRouting(),
    });
    const response = await handler.fetch(
      new Request("https://worker.example.com/at/abc/mcp", {
        method: "POST",
        headers: { authorization: "Bearer token" },
      }),
      makeEnv(),
      ctx
    );
    expect(response.status).toBe(200);
    expect(oauth.fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7.2: Run test to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=tenant-discovery
```
Expected: FAIL — tenant AS metadata path returns 404 (falls through to OAuthProvider mock)

- [ ] **Step 7.3: Wire tenant-oauth into `createWorkerExport`**

In `worker-entry.ts`, add an import at top:

```typescript
import {
  matchTenantOAuthPath,
  dispatchTenantOAuth,
} from "../tenant-oauth/tenant-router.js";
```

In `createWorkerExport`, just after the siteRouting `enabled` check (around line 339), insert the tenant-OAuth dispatch BEFORE the existing `siteRouter!.fetch` block:

```typescript
      if (useSiteRouter) {
        // 1. Tenant-OAuth paths (authorize/token/register/callback/well-known)
        //    are intercepted before OAuthProvider sees them. Includes the new
        //    per-tenant AS metadata and PRM endpoints.
        const tenantMatch = matchTenantOAuthPath(pathname);
        if (tenantMatch) {
          return dispatchTenantOAuth(
            tenantMatch,
            request,
            env,
            ctx,
            options.siteRouting!,
            oauthProvider
          );
        }

        // 2. Disable root /register under siteRouting (option (b) — see spec).
        //    Existing /authorize and /token paths remain functional for the
        //    RFC-8707 path; only registration is hard-disabled.
        if (pathname === "/register") {
          return new Response(
            JSON.stringify({
              error: "registration_disabled",
              error_description: "Use /at/<alias>/register",
            }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        // 3. Legacy PRM handler — kept for the per-tenant PRM, which now
        //    emits tenant-pinned authorization_servers.
        const opmPrefix = "/.well-known/oauth-protected-resource";
        if (pathname.startsWith(opmPrefix + "/")) {
          const resourcePath = pathname.slice(opmPrefix.length);
          if (siteRouter!.prefixRegex.test(resourcePath)) {
            return renderProtectedResourceMetadata(request, url, resourcePath);
          }
        }

        // 4. /at/<alias>/mcp — siteRouter validates + forwards to OAuthProvider.
        if (siteRouter!.prefixRegex.test(pathname)) {
          return siteRouter!.fetch(request, env, ctx);
        }
      }
```

(Replace the existing block at lines 341-354 with the above.)

- [ ] **Step 7.4: Run all tests to verify pass**

```bash
npm run compile -w packages/hosted-mcp && npm test -w packages/hosted-mcp
```
Expected: PASS for tenant-discovery, cloud-routing-gate, and all existing tests

- [ ] **Step 7.5: Commit**

```bash
git add packages/hosted-mcp/src/server/worker-entry.ts packages/hosted-mcp/src/server/__tests__/tenant-discovery.test.ts
git commit -m "feat(hosted-mcp): wire tenant-OAuth dispatcher and disable root /register under siteRouting"
```

---

## Task 8: Confused-deputy defence at root `/authorize`

When siteRouting is on AND the resource resolves to an alias, look up the client's registered tenant via the reverse index. Reject if missing or mismatched.

**Files:**
- Modify: `packages/hosted-mcp/src/auth/umbraco-handler.ts`
- Modify: `packages/hosted-mcp/src/auth/__tests__/umbraco-handler.test.ts`

- [ ] **Step 8.1: Write failing test for confused-deputy attack**

Append to `umbraco-handler.test.ts`:

```typescript
import { putClientBinding } from "../../tenant-oauth/binding-store.js";

describe("createAuthorizeHandler — root /authorize confused-deputy defence", () => {
  it("rejects 400 invalid_client when client is registered for a different tenant", async () => {
    const env = createMockEnv();
    // Client registered for tenant-a, attempting to authorize for tenant-b.
    const kv = env.OAUTH_KV as any;
    const store = new Map<string, string>();
    kv.get.mockImplementation(async (k: string) => store.get(k) ?? null);
    kv.put.mockImplementation(async (k: string, v: string) => { store.set(k, v); });
    await putClientBinding(kv, "tenant-a", "client-1");

    const siteRouting: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: async (id) => ({
        id,
        displayName: id,
        baseUrl: `https://${id}.example.com`,
        oauthClientId: "test-client",
      }),
    };

    const handler = createAuthorizeHandler(env, { siteRouting });
    const authRequest: OAuthAuthRequest = {
      ...createMockAuthRequest({ clientId: "client-1" }),
      resource: "https://worker.example.com/at/tenant-b",
    };
    const response = await handler(
      new Request("https://worker.example.com/authorize?client_id=client-1"),
      authRequest
    );
    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error).toBe("invalid_client");
  });

  it("rejects 400 invalid_client when client has no tenant binding at all", async () => {
    const env = createMockEnv();
    const kv = env.OAUTH_KV as any;
    kv.get.mockResolvedValue(null);

    const siteRouting: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: async (id) => ({
        id,
        displayName: id,
        baseUrl: `https://${id}.example.com`,
        oauthClientId: "test-client",
      }),
    };

    const handler = createAuthorizeHandler(env, { siteRouting });
    const authRequest: OAuthAuthRequest = {
      ...createMockAuthRequest({ clientId: "unbound-client" }),
      resource: "https://worker.example.com/at/tenant-a",
    };
    const response = await handler(
      new Request("https://worker.example.com/authorize?client_id=unbound-client"),
      authRequest
    );
    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error).toBe("invalid_client");
  });

  it("allows root /authorize when client tenant matches resource tenant (RFC-8707 path preserved)", async () => {
    const env = createMockEnv();
    const kv = env.OAUTH_KV as any;
    const store = new Map<string, string>();
    kv.get.mockImplementation(async (k: string) => store.get(k) ?? null);
    kv.put.mockImplementation(async (k: string, v: string) => { store.set(k, v); });
    await putClientBinding(kv, "tenant-a", "client-1");

    const siteRouting: SiteRoutingConfig = {
      pathPrefix: "/at/:siteId",
      resolveSite: async (id) => ({
        id,
        displayName: id,
        baseUrl: `https://${id}.example.com`,
        oauthClientId: "test-client",
      }),
    };

    mockConsentResponse.mockReturnValue(new Response("consent", { status: 200 }));

    const handler = createAuthorizeHandler(env, { siteRouting });
    const authRequest: OAuthAuthRequest = {
      ...createMockAuthRequest({ clientId: "client-1" }),
      resource: "https://worker.example.com/at/tenant-a",
    };
    const response = await handler(
      new Request("https://worker.example.com/authorize?client_id=client-1"),
      authRequest
    );
    // Should reach the consent screen, not be rejected
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 8.2: Run test to verify failure**

```bash
npm test -w packages/hosted-mcp -- --testPathPattern=umbraco-handler
```
Expected: FAIL — first two tests reach consent screen instead of being rejected

- [ ] **Step 8.3: Implement reverse-index check in `createAuthorizeHandler`**

In `umbraco-handler.ts`, add an import at top:

```typescript
import { getClientTenant } from "../tenant-oauth/binding-store.js";
```

In `createAuthorizeHandler`, after the existing `resolveSiteFromResource` call inside the GET branch (where `routedSite` is computed, around line 399-403), add a binding-check call. Place it inside the `if (siteRouting) { ... }` block, AFTER `resolveSiteFromResource` succeeds:

```typescript
    let routedSite: SiteConfig | undefined;
    if (siteRouting) {
      const result = await resolveSiteFromResource(authRequest.resource);
      if (!result.ok) return result.response;
      routedSite = result.site;

      // Confused-deputy defence: when siteRouting is on, the client_id MUST
      // be registered for the resolved tenant via the per-tenant DCR flow.
      // A client registered at /at/A/register cannot authorise for tenant B
      // even via root /authorize?resource=${origin}/at/B — the reverse index
      // catches the cross-tenant attempt.
      const registeredTenant = await getClientTenant(env.OAUTH_KV, authRequest.clientId);
      if (registeredTenant !== routedSite.id) {
        return new Response(
          JSON.stringify({
            error: "invalid_client",
            error_description: "Client not registered for this site",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }
```

Apply the same check inside the POST branch (consent submission), after `resolveSiteFromResource` and before the redirect to Umbraco. Place it right after `site = result.site;` (around line 324):

```typescript
      if (siteRouting) {
        const result = await resolveSiteFromResource(authRequest.resource);
        if (!result.ok) return result.response;
        site = result.site;
        // Same binding check on POST (consent submission) — defence in depth.
        const registeredTenant = await getClientTenant(env.OAUTH_KV, authRequest.clientId);
        if (registeredTenant !== site.id) {
          return new Response(
            JSON.stringify({
              error: "invalid_client",
              error_description: "Client not registered for this site",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        consentChoices = { ...(consentChoices ?? {}), siteId: result.site.id };
      } else {
```

- [ ] **Step 8.4: Run tests to verify pass**

```bash
npm run compile -w packages/hosted-mcp && npm test -w packages/hosted-mcp -- --testPathPattern=umbraco-handler
```
Expected: PASS

- [ ] **Step 8.5: Run full unit suite**

```bash
npm test -w packages/hosted-mcp
```
Expected: ALL PASS

- [ ] **Step 8.6: Commit**

```bash
git add packages/hosted-mcp/src/auth/umbraco-handler.ts packages/hosted-mcp/src/auth/__tests__/umbraco-handler.test.ts
git commit -m "feat(hosted-mcp): confused-deputy defence at root /authorize via reverse-index check"
```

---

## Task 9: Integration test (Wrangler `unstable_dev`)

End-to-end discovery + DCR + authorize flow against a real Wrangler-spawned Worker. Mirrors the existing `tests/integration/*.test.ts` pattern.

**Files:**
- Create: `packages/hosted-mcp/tests/integration/tenant-oauth-flow.test.ts`

- [ ] **Step 9.1: Read the existing integration helper to confirm patterns**

```bash
ls packages/hosted-mcp/tests/integration/
cat packages/hosted-mcp/tests/integration/wrangler.integration.toml 2>/dev/null || true
```
Adapt the new test to the same setup style.

- [ ] **Step 9.2: Write the failing integration test**

```typescript
// packages/hosted-mcp/tests/integration/tenant-oauth-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { unstable_dev, type UnstableDevWorker } from "wrangler";
import * as path from "node:path";

describe("tenant-OAuth end-to-end discovery and DCR", () => {
  let worker: UnstableDevWorker;
  let baseUrl: string;

  beforeAll(async () => {
    worker = await unstable_dev(
      path.resolve(__dirname, "../fixtures/tenant-oauth-worker.ts"),
      {
        config: path.resolve(__dirname, "wrangler.integration.toml"),
        experimental: { disableExperimentalWarning: true },
        local: true,
      }
    );
    baseUrl = `http://${worker.address}:${worker.port}`;
  }, 60000);

  afterAll(async () => {
    await worker?.stop();
  });

  it("PRM at /.well-known/oauth-protected-resource/at/<alias> returns tenant-pinned authorization_servers", async () => {
    const r = await worker.fetch("/.well-known/oauth-protected-resource/at/demo");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.authorization_servers).toEqual([`${baseUrl}/at/demo`]);
  });

  it("AS metadata at /.well-known/oauth-authorization-server/at/<alias> returns RFC 8414 doc with tenant-prefixed endpoints", async () => {
    const r = await worker.fetch("/.well-known/oauth-authorization-server/at/demo");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.issuer).toBe(`${baseUrl}/at/demo`);
    expect(body.authorization_endpoint).toBe(`${baseUrl}/at/demo/authorize`);
    expect(body.token_endpoint).toBe(`${baseUrl}/at/demo/token`);
    expect(body.registration_endpoint).toBe(`${baseUrl}/at/demo/register`);
  });

  it("DCR at /at/<alias>/register succeeds and creates per-tenant binding", async () => {
    const r = await worker.fetch("/at/demo/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test Client",
        redirect_uris: [`${baseUrl}/at/demo/callback`],
      }),
    });
    expect([200, 201]).toContain(r.status);
    const body = await r.json() as any;
    expect(typeof body.client_id).toBe("string");
  });

  it("root /register returns 404 under siteRouting", async () => {
    const r = await worker.fetch("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Test", redirect_uris: ["http://localhost"] }),
    });
    expect(r.status).toBe(404);
    const body = await r.json() as any;
    expect(body.error).toBe("registration_disabled");
  });

  it("/at/A/authorize with client registered at /at/B is rejected 400 invalid_client", async () => {
    // Register at tenant-b
    const reg = await worker.fetch("/at/tenant-b/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "B Client",
        redirect_uris: [`${baseUrl}/at/tenant-b/callback`],
      }),
    });
    const { client_id } = (await reg.json()) as any;

    // Attempt to authorize at tenant-a
    const r = await worker.fetch(
      `/at/tenant-a/authorize?client_id=${encodeURIComponent(client_id)}&response_type=code&redirect_uri=${encodeURIComponent(`${baseUrl}/at/tenant-a/callback`)}&state=xyz`,
      { redirect: "manual" }
    );
    expect(r.status).toBe(400);
    const body = await r.json() as any;
    expect(body.error).toBe("invalid_client");
  });

  it("root /authorize?resource=...B with client registered at A is rejected (confused-deputy)", async () => {
    // Register at tenant-a
    const reg = await worker.fetch("/at/tenant-a/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "A Client",
        redirect_uris: [`${baseUrl}/at/tenant-a/callback`],
      }),
    });
    const { client_id } = (await reg.json()) as any;

    // Confused-deputy: root authorize with resource=B
    const r = await worker.fetch(
      `/authorize?client_id=${encodeURIComponent(client_id)}&response_type=code&resource=${encodeURIComponent(`${baseUrl}/at/tenant-b`)}&redirect_uri=${encodeURIComponent(`${baseUrl}/at/tenant-a/callback`)}&state=xyz`,
      { redirect: "manual" }
    );
    expect(r.status).toBe(400);
    const body = await r.json() as any;
    expect(body.error).toBe("invalid_client");
  });
});
```

- [ ] **Step 9.3: Create the test fixture worker**

If `tests/integration/fixtures/` doesn't exist or doesn't have a tenant-routing worker, create one. Inspect existing fixtures first:

```bash
ls packages/hosted-mcp/tests/integration/fixtures/ 2>/dev/null || true
```

Pattern: copy an existing fixture, swap in `siteRouting` with a static `resolveSite` that always returns a fixture site for any alias matching `/^[a-z][a-z0-9-]*$/`. Sample:

```typescript
// packages/hosted-mcp/tests/integration/fixtures/tenant-oauth-worker.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  createDefaultHandler,
  createWorkerExport,
  createSiteRoutingApiHandler,
  type HostedMcpEnv,
  type AuthProps,
} from "../../../src/index.js";

const options = {
  name: "tenant-oauth-test",
  version: "0.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
  siteRouting: {
    pathPrefix: "/at/:siteId",
    resolveSite: async (siteId: string) => {
      if (!/^[a-z][a-z0-9-]*$/.test(siteId)) return null;
      return {
        id: siteId,
        displayName: siteId,
        baseUrl: `https://${siteId}.example.com`,
        oauthClientId: "test-client",
      };
    },
  },
};

export class UmbracoMcpAgent extends McpAgent<HostedMcpEnv, unknown, AuthProps> {
  server!: McpServer;
  async init() {
    this.server = new McpServer({ name: options.name, version: options.version });
  }
}

const provider = new OAuthProvider({
  apiRoute: ["/mcp", "/at/"],
  apiHandler: createSiteRoutingApiHandler(
    UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }) as any
  ) as any,
  defaultHandler: createDefaultHandler(options) as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default createWorkerExport(provider, options);
```

- [ ] **Step 9.4: Build and run integration tests**

```bash
npm run build -w packages/hosted-mcp && npm run test:integration -w packages/hosted-mcp -- --testPathPattern=tenant-oauth-flow
```
Expected: PASS — all 6 integration assertions

- [ ] **Step 9.5: Commit**

```bash
git add packages/hosted-mcp/tests/integration/
git commit -m "test(hosted-mcp): integration tests for tenant-OAuth flow"
```

---

## Task 10: Final integration check + PR

- [ ] **Step 10.1: Run full unit + integration suite**

```bash
npm run compile -w packages/hosted-mcp
npm test -w packages/hosted-mcp
npm run build -w packages/hosted-mcp
npm run test:integration -w packages/hosted-mcp
```
Expected: ALL PASS

- [ ] **Step 10.2: Push branch and open PR**

```bash
git push -u origin feat/100-tenant-pinned-authorization-servers
gh pr create --base dev --title "feat(hosted-mcp): tenant-pinned authorization_servers (#100)" --body "$(cat <<'EOF'
## Summary

Closes #100. Lets non-RFC-8707 MCP clients (ChatGPT) complete OAuth against site-routed Workers without sending the `resource` parameter, while preserving the existing RFC-8707 path and closing the confused-deputy door across tenants.

- PRM advertises tenant-pinned `authorization_servers`
- New per-tenant AS metadata at `/.well-known/oauth-authorization-server/at/<alias>` (RFC 8414 §3 strict — verified via the spike on `spike/chatgpt-oauth-discovery`)
- Per-tenant DCR with forward + reverse binding indexes; root `/register` returns 404 under siteRouting
- Confused-deputy defence at root `/authorize` via reverse-index lookup
- Strict-equals `resource` validation against the canonical PRM value

Spec: `docs/superpowers/specs/2026-05-08-issue-100-tenant-pinned-as-design.md`
Plan: `docs/superpowers/plans/2026-05-09-issue-100-tenant-pinned-as.md`

## Test plan

- [x] Unit: `npm test -w packages/hosted-mcp` (~280 tests including new ones)
- [x] Integration: `npm run test:integration -w packages/hosted-mcp` (Wrangler unstable_dev)
- [ ] CI green (watching after push)

## Rollout note

Canonical `aud` becomes `${origin}/at/<alias>`. In-flight tokens fail audience validation until they expire (60-min default TTL). See spec's "Rollout" section.
EOF
)"
```

- [ ] **Step 10.3: Watch CI**

```bash
PR=$(gh pr view --json number -q .number)
gh pr checks $PR --watch
```
Inspect any failures with `gh run view <run-id> --log-failed` and fix root cause + push.

- [ ] **Step 10.4: When CI green, post a comment on issue #100 referencing the PR**

```bash
gh issue comment 100 --body "Implementation in #$PR — design doc and plan committed in the branch under \`docs/superpowers/\`."
```

---

## Verification checklist (from spec)

After Task 10 completes, walk the spec's verification checklist:

- [ ] PRM at `/.well-known/oauth-protected-resource/at/<alias>` advertises `authorization_servers: [${origin}/at/<alias>]` — covered by Task 6 + Task 9
- [ ] `/.well-known/oauth-authorization-server/at/<alias>` returns 200 unauthenticated, valid RFC 8414 doc — Task 4 + Task 9
- [ ] OPTIONS preflight returns 204 with CORS headers on the new well-known — Task 4
- [ ] `POST /at/<alias>/register` succeeds and creates BOTH binding records — Task 5 + Task 9
- [ ] `GET /at/<alias>/authorize?client_id=X` succeeds when bound, fails when unbound or mis-bound — Task 5 + Task 9
- [ ] `redirect_uri` registered at `/at/<alias>/register` is preserved unchanged through `/at/<alias>/authorize` — Task 5
- [ ] `resource` strict match: trailing-slash, `/mcp`-suffix, host/scheme variants rejected — Task 2 + Task 5
- [ ] `POST /register` (root) returns 404 when siteRouting gate is on — Task 7 + Task 9
- [ ] `POST /register` (root) works as today when siteRouting is off — Task 7
- [ ] Root `/authorize` confused-deputy attempt returns 400 invalid_client — Task 8 + Task 9
- [ ] Root `/authorize` legitimate same-tenant case still succeeds (RFC-8707 path preserved) — Task 8
- [ ] Token issued via `/at/<alias>/authorize` (no client `resource`) carries `aud = ${origin}/at/<alias>` — Task 9 (smoke; full e2e validates against real Umbraco)
- [ ] `/at/<alias>/mcp` accepts the tenant-bound token; `/at/<other>/mcp` rejects — existing siteRouter behaviour, unchanged
- [ ] RFC-8707 client (sends `resource`) still completes flow via root `/authorize` when siteRouting is on — Task 8 (covered by "legitimate same-tenant" test)
- [ ] Single-tenant Worker (no `siteRouting`) sees zero behavior change — covered by existing tests + Task 7's gate-off cases

E2E with running Umbraco (manual, after PR lands):

- [ ] MCP Inspector connects to `/at/<alias>/mcp` against the real test Umbraco, completes full OAuth, lists tools.
- [ ] ChatGPT Connector simulation (point at a deployed Worker hosted via the spike branch's pattern) — confirm the discovery walk completes end-to-end against the new code.
