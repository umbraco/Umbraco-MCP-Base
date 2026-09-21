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
 * 3. **Absent means absent.** No consent choice yet, no auth, no configured
 *    key — the value is simply not produced. Nothing is defaulted, stubbed or
 *    hashed from `undefined`.
 *
 * The region half is the exception to rules 1–2: `euwest01` is low-cardinality
 * infrastructure, shared by thousands of projects, and identifies nobody. It
 * goes out in plaintext so dashboards can break tenant spread down by region
 * without anyone needing to reverse a hash.
 */

import type { RequestTelemetryContext } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import type { AuthProps } from "../types/auth.js";
import { regionOnly } from "../cloud/site-id.js";

/** Hex-encodes a digest. Lower case, no separators — a stable attribute value. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
 * needs no polyfill in either place.
 *
 * @param value - The value to hash, e.g. a `siteId` or an `umbracoTokenKey`
 * @param key - The `TENANT_HASH_KEY` secret
 * @returns Lower-case hex HMAC-SHA256 digest
 */
export async function hashWithKey(value: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return toHex(signature);
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
    const region = regionOnly(siteId);
    if (region) {
      telemetry.region = region;
    }
  }

  const hashKey = env.TENANT_HASH_KEY;
  if (typeof hashKey !== "string" || hashKey.length === 0) {
    // No key configured (local dev, or the secret isn't deployed yet). Tenant
    // and login-session both ride this same hash — the alias must not be
    // emitted in tenant's place, and the raw token key must not be emitted in
    // login-session's. Dropping both rather than the SDK's older behaviour
    // (forwarding the token key unhashed) is deliberate: `umbracoTokenKey` is
    // also the KV lookup key for that login's stored Umbraco access/refresh
    // tokens (`token-storage.ts`), so exporting it verbatim to the tracing
    // backend would hand anyone who can read spans a live credential-store
    // key. Region alone (already plaintext, already low-cardinality) still
    // goes out.
    return telemetry;
  }

  if (siteId) {
    try {
      telemetry.tenant = await hashWithKey(siteId, hashKey);
    } catch (error) {
      console.error("[mcp-hosted] failed to compute tenant hash; omitting the attribute:", error);
    }
  }

  // Opaque from birth — minted by `generateSecureRandom()` at OAuth login and
  // only rotated when the refresh token expires, so it survives the MCP
  // transport's reconnects in a way `mcp.session.id` deliberately doesn't.
  // Hashed all the same: being random doesn't stop it from also being the KV
  // key that unlocks this login's stored Umbraco tokens (see `hashWithKey`'s
  // doc comment) — the exported attribute must not double as that key.
  const loginSession = props?.umbracoTokenKey;
  if (typeof loginSession === "string" && loginSession.length > 0) {
    try {
      telemetry.loginSession = await hashWithKey(loginSession, hashKey);
    } catch (error) {
      console.error(
        "[mcp-hosted] failed to compute login-session hash; omitting the attribute:",
        error
      );
    }
  }

  return telemetry;
}
