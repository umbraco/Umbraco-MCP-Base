/**
 * Request-Scoped Telemetry Values
 *
 * Turns what the Worker knows about a request — which Cloud project consented,
 * which region it lives in, which login produced the token — into the SDK's
 * `RequestTelemetryContext`, so `withTelemetry` can put them on that call's
 * span.
 *
 * Two rules shape everything here:
 *
 * 1. **The plaintext `siteId` never leaves the Worker.** An Umbraco Cloud
 *    project alias identifies a customer, so the tenant attribute is
 *    `HMAC-SHA256(siteId, TENANT_HASH_KEY)` — keyed, so the mapping can't be
 *    rebuilt by anyone holding the exported spans and a list of aliases. The
 *    *whole* siteId is hashed, region included, so two regions of one alias
 *    stay distinct tenants.
 * 2. **Absent means absent.** No consent choice yet, no auth, no configured
 *    key — the value is simply not produced. Nothing is defaulted, stubbed or
 *    hashed from `undefined`.
 *
 * The region half is the exception to rule 1: `euwest01` is low-cardinality
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
 * Computes the tenant attribute for a site identifier.
 *
 * Deterministic for a given (`siteId`, `key`) pair — the same project always
 * produces the same tenant value, which is the whole point for a dashboard
 * counting distinct tenants — and irreversible without the key.
 *
 * `crypto.subtle` is available on the Workers runtime and on Node 18+, so this
 * needs no polyfill in either place.
 *
 * @param siteId - The full site identifier, `<alias>` or `<alias>.<region>`
 * @param key - The `TENANT_HASH_KEY` secret
 * @returns Lower-case hex HMAC-SHA256 digest
 */
export async function hashTenant(siteId: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(siteId));
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

  // Opaque from birth — minted by `generateSecureRandom()` at OAuth login and
  // only rotated when the refresh token expires, so it survives the MCP
  // transport's reconnects in a way `mcp.session.id` deliberately doesn't.
  // Forwarded as-is: hashing a random value would buy nothing.
  const loginSession = props?.umbracoTokenKey;
  if (typeof loginSession === "string" && loginSession.length > 0) {
    telemetry.loginSession = loginSession;
  }

  const siteId = props?.consentChoices?.siteId;
  if (typeof siteId !== "string" || siteId.length === 0) {
    // Single-tenant deployment, or no site chosen yet. No tenant, no region —
    // and emphatically no hash of `undefined`.
    return telemetry;
  }

  const region = regionOnly(siteId);
  if (region) {
    telemetry.region = region;
  }

  const hashKey = env.TENANT_HASH_KEY;
  if (typeof hashKey !== "string" || hashKey.length === 0) {
    // No key configured (local dev, or the secret isn't deployed yet). The
    // alias must not be emitted in its place.
    return telemetry;
  }

  try {
    telemetry.tenant = await hashTenant(siteId, hashKey);
  } catch (error) {
    console.error("[mcp-hosted] failed to compute tenant hash; omitting the attribute:", error);
  }

  return telemetry;
}
