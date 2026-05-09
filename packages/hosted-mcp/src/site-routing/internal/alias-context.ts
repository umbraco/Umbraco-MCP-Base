/**
 * Internal helpers shared between site-routing/ and tenant-oauth/.
 * Not part of the public package surface.
 */

import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../../types/multi-site.js";
import { buildPrefixRegex } from "../path-prefix.js";

/**
 * The canonical `resource` value for a tenant — `${origin}/at/<alias>` with
 * no trailing slash and no path suffix. This is the byte-equal target the
 * resource-match validator compares against.
 */
export function canonicalResourceForAlias(origin: string, alias: string): string {
  const trimmedOrigin = origin.replace(/\/+$/, "");
  return `${trimmedOrigin}/at/${alias}`;
}

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

function buildAliasMatchRegex(pathPrefix: string): RegExp {
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
