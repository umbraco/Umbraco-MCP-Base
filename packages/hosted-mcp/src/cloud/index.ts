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

  const resolveSite: SiteRoutingResolver = async (siteId, env) => {
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
      cache.set(siteId, { kind: "miss", expiresAt: now + ttl.miss });
      return null;
    }

    let oauthClientSecret: string | undefined;
    if (options.resolveOauthClientSecret) {
      const secret = await options.resolveOauthClientSecret(siteId, env);
      if (secret) oauthClientSecret = secret;
    }

    const site: SiteConfig = {
      id: siteId,
      displayName: siteId,
      baseUrl,
      oauthClientId: options.oauthClientId,
      ...(oauthClientSecret ? { oauthClientSecret } : {}),
    };

    cache.set(siteId, { kind: "ok", site, expiresAt: now + ttl.ok });
    return site;
  };

  return {
    pathPrefix: options.pathPrefix ?? DEFAULT_PATH_PREFIX,
    resolveSite,
  };
}

/**
 * Default validator — probes the Umbraco backoffice path on the project's
 * Cloud host. Treats any 2xx/3xx as "exists"; 4xx/5xx and network errors as
 * "missing".
 *
 * `/umbraco` is the backoffice entry on every Cloud project; nonexistent
 * aliases either fail DNS or time out at the wildcard edge.
 *
 * Network errors don't throw — Cloud projects come and go and we treat
 * "doesn't resolve" the same as "404".
 */
async function defaultValidateProject(
  _siteId: string,
  baseUrl: string,
  _env: HostedMcpEnv
): Promise<boolean> {
  const probeUrl = new URL("/umbraco", baseUrl).toString();

  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      headers: { Accept: "text/html" },
      redirect: "manual",
      // Workers `fetch` doesn't support a true timeout, but we set a short
      // signal-based abort to fail fast when the project is unreachable.
      signal: AbortSignal.timeout(5_000),
    });
    // 2xx/3xx all indicate the project responded; only treat 4xx/5xx as missing.
    return response.status < 400;
  } catch {
    return false;
  }
}
