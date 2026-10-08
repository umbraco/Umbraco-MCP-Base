/**
 * Request-Scoped Telemetry Values
 *
 * Turns what the Worker knows about a request — which Cloud project consented,
 * which region it lives in, which login produced the token — into the SDK's
 * `RequestTelemetryContext`, so `withTelemetry` can put them on that call's
 * span.
 *
 * Three rules shape everything here:
 *
 * 1. **The plaintext `siteId` never leaves the Worker.** An Umbraco Cloud
 *    project alias identifies a customer, so the tenant attribute is
 *    `HMAC-SHA256(siteId, TENANT_HASH_KEY)` — keyed, so the mapping can't be
 *    rebuilt by anyone holding the exported spans and a list of aliases. The
 *    *whole* siteId is hashed, region included, so two regions of one alias
 *    stay distinct tenants.
 * 2. **Neither does `umbracoTokenKey`, for a different reason.** It's opaque
 *    from birth (not identifying on its own), but it's also the KV key the
 *    Worker uses to look up that login's stored Umbraco access/refresh
 *    tokens (`token-storage.ts`'s `umbraco_token:${tokenKey}`). Forwarding it
 *    unhashed would export a live credential-store key to whatever reads the
 *    tracing backend. It rides the same `TENANT_HASH_KEY`-keyed hash as
 *    tenant, so the exported `login_session` attribute stays stable and
 *    distinct per login without being usable as that key outside the Worker.
 * 3. **Absent means absent — for tenant and login-session.** No consent
 *    choice yet, no auth, no configured key — those two are never defaulted,
 *    stubbed or hashed from `undefined`.
 *
 * The region half is the exception to rules 1–2, in two ways: it's
 * low-cardinality infrastructure shared by thousands of projects and
 * identifies nobody, so it goes out in plaintext; and, unlike tenant/
 * login-session, it *is* defaulted for a Cloud site — `consentChoices.region`
 * (set by the Cloud site-routing resolver, `cloud/index.ts`) carries the
 * resolver's own default-region fallback for a bare-alias siteId, so a
 * connection that works (resolves to a real Cloud host under that default)
 * also reports the region it was actually resolved against, rather than
 * silently omitting it. A site with no `consentChoices.region` at all — not
 * Cloud-routed, e.g. self-hosted — still falls back to parsing an embedded
 * region straight off `siteId`, and stays unset if there isn't one; nothing
 * is guessed for those.
 *
 * Tenant and login-session are hashed under `TENANT_HASH_KEY` by default, but
 * `LOGIN_SESSION_HASH_KEY` (env.ts) can override the latter independently —
 * rotating one need not relabel the other's historical span data. When both
 * resolve to the same key material (the default), the imported `CryptoKey` is
 * reused rather than importing it twice per request.
 */

import type { RequestTelemetryContext } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import type { AuthProps } from "../types/auth.js";
import { regionOnly } from "../cloud/site-id.js";
import { toHex } from "../crypto/hex.js";

/**
 * Imports raw key material for HMAC-SHA256 signing.
 *
 * Split out from `hashWithKey` so a caller signing more than one value under
 * the same key material in one request (`resolveRequestTelemetry`) can import
 * once and reuse the `CryptoKey`, instead of paying `importKey` per value.
 */
async function importHmacKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/** Signs `value` with an already-imported HMAC key and returns lower-case hex. */
async function signHex(cryptoKey: CryptoKey, value: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return toHex(new Uint8Array(signature));
}

/**
 * Computes a keyed HMAC-SHA256 digest of a value.
 *
 * Deterministic for a given (`value`, `key`) pair — the same input always
 * produces the same output, which is the whole point for a dashboard
 * counting distinct tenants or logins — and irreversible without the key.
 * Used for both the tenant attribute (over `siteId`) and the login-session
 * attribute (over `umbracoTokenKey`): the latter is opaque from birth, but
 * it doubles as the KV lookup key for that login's stored Umbraco tokens
 * (see `token-storage.ts`), so forwarding it as-is would export a live
 * credential-store key to the tracing backend. Hashing it costs nothing —
 * it's still stable and distinct per login — and removes that as a usable
 * key outside the Worker.
 *
 * `crypto.subtle` is available on the Workers runtime and on Node 18+, so this
 * needs no polyfill in either place. Standalone convenience — imports the key
 * fresh every call; `resolveRequestTelemetry` uses `importHmacKey`/`signHex`
 * directly so it can reuse one import across both attributes.
 *
 * @param value - The value to hash, e.g. a `siteId` or an `umbracoTokenKey`
 * @param key - The hash key secret (`TENANT_HASH_KEY` or `LOGIN_SESSION_HASH_KEY`)
 * @returns Lower-case hex HMAC-SHA256 digest
 */
export async function hashWithKey(value: string, key: string): Promise<string> {
  const cryptoKey = await importHmacKey(key);
  return signHex(cryptoKey, value);
}

/**
 * Builds the per-request telemetry values for one authenticated MCP request.
 *
 * Never throws: a broken or missing `TENANT_HASH_KEY` costs a dimension on a
 * dashboard, and that is not worth failing a tool call over. A failure is
 * logged once and the tenant attribute is left unset.
 *
 * @param props - Auth props from the OAuthProvider for this request
 * @param env - Worker environment bindings (supplies `TENANT_HASH_KEY`)
 * @returns The values to carry; fields are omitted, never blank
 */
export async function resolveRequestTelemetry(
  props: AuthProps | undefined,
  env: HostedMcpEnv
): Promise<RequestTelemetryContext> {
  const telemetry: RequestTelemetryContext = {};

  const siteId = props?.consentChoices?.siteId;
  if (typeof siteId === "string" && siteId.length > 0) {
    // Prefer the resolver's own resolved region (set for every Cloud-routed
    // site, embedded-region or not — see the module doc) over parsing siteId
    // directly, which only ever finds an *embedded* region and leaves a bare
    // alias — Cloud-routed or not — unset.
    const region = props?.consentChoices?.region ?? regionOnly(siteId);
    if (region) {
      telemetry.region = region;
    }
  }

  const tenantKey = env.TENANT_HASH_KEY;
  // Independent key optional, defaults to tenant's — see env.ts and the
  // module doc comment above.
  const loginSessionKey = env.LOGIN_SESSION_HASH_KEY || tenantKey;

  // No key configured (local dev, or the secret isn't deployed yet) leaves
  // the corresponding attribute unset — the alias must not be emitted in
  // tenant's place, and the raw token key must not be emitted in
  // login-session's (it's also the KV lookup key for that login's stored
  // Umbraco access/refresh tokens, see `hashWithKey`'s doc comment). Region
  // alone (already plaintext, already low-cardinality) still goes out
  // regardless of either key's presence.
  let tenantCryptoKey: CryptoKey | undefined;
  if (siteId && typeof tenantKey === "string" && tenantKey.length > 0) {
    try {
      tenantCryptoKey = await importHmacKey(tenantKey);
      telemetry.tenant = await signHex(tenantCryptoKey, siteId);
    } catch (error) {
      console.error("[mcp-hosted] failed to compute tenant hash; omitting the attribute:", error);
    }
  }

  // Opaque from birth — minted by `generateSecureRandom()` at OAuth login and
  // only rotated when the refresh token expires, so it survives the MCP
  // transport's reconnects in a way `mcp.session.id` deliberately doesn't.
  // Hashed all the same: being random doesn't stop it from also being the KV
  // key that unlocks this login's stored Umbraco tokens.
  const loginSession = props?.umbracoTokenKey;
  if (typeof loginSession === "string" && loginSession.length > 0 &&
    typeof loginSessionKey === "string" && loginSessionKey.length > 0) {
    try {
      // Reuse the tenant import when both attributes share key material
      // (the default) instead of importing it a second time.
      const cryptoKey =
        loginSessionKey === tenantKey && tenantCryptoKey
          ? tenantCryptoKey
          : await importHmacKey(loginSessionKey);
      telemetry.loginSession = await signHex(cryptoKey, loginSession);
    } catch (error) {
      console.error(
        "[mcp-hosted] failed to compute login-session hash; omitting the attribute:",
        error
      );
    }
  }

  return telemetry;
}
