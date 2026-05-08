/**
 * Umbraco Cloud preset for URL-based site routing.
 *
 * Wraps the generic `SiteRoutingConfig` with Cloud conventions:
 *   - URL pattern `https://{alias}.{region}.umbraco.io`
 *   - Pre-flight validation against `.well-known/oauth-authorization-server`
 *   - Cached resolution (ms-level memo, scoped to a worker isolate)
 *
 * Each Umbraco Cloud project is expected to register its own OAuth client with
 * the standardised `oauthClientId` (e.g. "mcp-cms-editor"). Public/PKCE clients
 * don't need a secret — for confidential clients, supply `resolveOauthClientSecret`.
 */

import type { HostedMcpEnv } from "../types/env.js";
import type {
  SiteConfig,
  SiteRoutingConfig,
  SiteRoutingResolver,
} from "../types/multi-site.js";

export interface UmbracoCloudRoutingOptions {
  /**
   * OAuth client_id registered in each Cloud project (e.g. "mcp-cms-editor").
   * Same value across every project for a given MCP type.
   */
  oauthClientId: string;
  /**
   * Cloud region used to build the project URL (`{alias}.{region}.umbraco.io`).
   * Defaults to `env.UMBRACO_CLOUD_REGION` at request time, or `"euwest01"`
   * when neither option nor env var is set.
   */
  region?: string;
  /**
   * Resolve a per-project OAuth client_secret. Omit for PKCE / public clients
   * (recommended). When provided, the returned string is used as the
   * confidential-client secret.
   */
  resolveOauthClientSecret?: (
    siteId: string,
    env: HostedMcpEnv
  ) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Override the default validation. The default fetches
   * `https://{alias}.{region}.umbraco.io/.well-known/oauth-authorization-server`
   * and treats a 2xx response with a JSON body as "exists".
   *
   * Return `true` to allow the project, `false` to reject (the router
   * surfaces this as 404). Throw to surface 502.
   */
  validateProject?: (
    siteId: string,
    baseUrl: string,
    env: HostedMcpEnv
  ) => boolean | Promise<boolean>;
  /**
   * Override the path prefix. Defaults to `/at/:siteId`.
   */
  pathPrefix?: string;
  /**
   * Override the runtime gate predicate. Defaults to
   * `(env) => env.UMBRACO_CLOUD_ROUTING_ENABLED === "true"` so infra
   * (`wrangler.toml [vars]`) can flip cloud mode at deploy time without
   * consumer source edits. Pass a custom predicate (or `() => true`) to
   * gate cloud routing on a different env var or always-on behaviour.
   */
  enabled?: (env: HostedMcpEnv) => boolean;
  /**
   * Cache TTLs in milliseconds. Defaults to `{ ok: 60_000, miss: 30_000, error: 10_000 }`.
   */
  cacheTtl?: {
    ok?: number;
    miss?: number;
    error?: number;
  };
}

const DEFAULT_REGION = "euwest01";
const DEFAULT_PATH_PREFIX = "/at/:siteId";
const DEFAULT_CACHE_TTL = { ok: 60_000, miss: 30_000, error: 10_000 };
// Cap to keep the per-isolate cache bounded — at this point we evict expired
// entries and, if still over the cap, drop the oldest. Stops a stream of
// unique aliases (typos, scans) from growing the Map without bound.
const MAX_CACHE_ENTRIES = 1_000;

type CacheEntry =
  | { kind: "ok"; site: SiteConfig; expiresAt: number }
  | { kind: "miss"; expiresAt: number };

/**
 * Build a `SiteRoutingConfig` preconfigured for Umbraco Cloud.
 */
export function umbracoCloudSiteRouting(
  options: UmbracoCloudRoutingOptions
): SiteRoutingConfig {
  const ttl = { ...DEFAULT_CACHE_TTL, ...options.cacheTtl };
  const cache = new Map<string, CacheEntry>();

  const setCache = (siteId: string, entry: CacheEntry): void => {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [key, value] of cache) {
        if (value.expiresAt <= now) cache.delete(key);
      }
      while (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }
    cache.set(siteId, entry);
  };

  const enabled =
    options.enabled ??
    ((env: HostedMcpEnv) => env.UMBRACO_CLOUD_ROUTING_ENABLED === "true");

  const resolveSite: SiteRoutingResolver = async (siteId, env) => {
    // Defense in depth — the primary gates live in `createWorkerExport` /
    // `createDefaultHandler`, which consult the same `enabled` predicate
    // exposed below and short-circuit before this resolver is invoked.
    if (!enabled(env)) {
      return null;
    }

    const now = Date.now();
    const cached = cache.get(siteId);
    if (cached && cached.expiresAt > now) {
      return cached.kind === "ok" ? cached.site : null;
    }

    const region = options.region ?? env.UMBRACO_CLOUD_REGION ?? DEFAULT_REGION;
    const baseUrl = `https://${siteId}.${region}.umbraco.io`;

    const validator = options.validateProject ?? defaultValidateProject;
    const exists = await validator(siteId, baseUrl, env);

    if (!exists) {
      setCache(siteId, { kind: "miss", expiresAt: now + ttl.miss });
      return null;
    }

    const oauthClientSecret = options.resolveOauthClientSecret
      ? (await options.resolveOauthClientSecret(siteId, env)) ?? undefined
      : undefined;

    const site: SiteConfig = {
      id: siteId,
      displayName: siteId,
      baseUrl,
      oauthClientId: options.oauthClientId,
      ...(oauthClientSecret ? { oauthClientSecret } : {}),
    };

    setCache(siteId, { kind: "ok", site, expiresAt: now + ttl.ok });
    return site;
  };

  return {
    pathPrefix: options.pathPrefix ?? DEFAULT_PATH_PREFIX,
    resolveSite,
    enabled,
  };
}

/**
 * Default validator — GETs `/umbraco` on the Cloud host. Any 2xx/3xx is
 * "exists"; 4xx/5xx and network failures are "missing". (HEAD looks tempting
 * but Cloud's edge returns 404 for HEAD on this path.)
 */
async function defaultValidateProject(
  _siteId: string,
  baseUrl: string,
  _env: HostedMcpEnv
): Promise<boolean> {
  try {
    const response = await fetch(new URL("/umbraco", baseUrl).toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    response.body?.cancel();
    return response.status < 400;
  } catch {
    return false;
  }
}
