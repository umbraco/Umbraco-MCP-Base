/**
 * Umbraco Cloud preset for URL-based site routing.
 *
 * Wraps the generic `SiteRoutingConfig` with Cloud conventions:
 *   - URL pattern `https://{alias}.{region}.umbraco.io`
 *   - Pre-flight validation: a GET of `/umbraco` on the project host
 *   - Cached resolution (ms-level memo, scoped to a worker isolate)
 *   - A `cloud_site_seen:<siteId>` marker in `OAUTH_KV` (30 days) for each
 *     resolved site, used to tell a known site that is down from an alias
 *     that doesn't exist
 *
 * Each Umbraco Cloud project is expected to register its own OAuth client with
 * the standardised `oauthClientId` (e.g. "mcp-cms-editor"). Public/PKCE clients
 * don't need a secret — for confidential clients, supply `resolveOauthClientSecret`.
 *
 * ### Region resolution
 *
 * One Worker serves every Cloud project for its product/type/major, and
 * those projects can live in more than one Cloud region — the `siteId`
 * extracted from `/at/:siteId` alone doesn't say which. Preferred: mint the
 * connection URL with the region already embedded as `<alias>.<region>`
 * (e.g. `/at/example-project.uksouth01/mcp`), mirroring Cloud's own
 * hostname convention — this resolves with a single validation call, no
 * guessing required. Whoever generates the URL for a customer project
 * already knows its region (it's in the project's own host), so this is
 * just carrying that value through. Legacy bare-alias URLs (`/at/<alias>/mcp`,
 * no region) fall back to the single `region` option below — the Worker
 * does not need to know every possible Cloud region up front, only the one
 * default region its bare-alias URLs target.
 */

import { siteRef } from "../telemetry/request-telemetry.js";
import type { HostedMcpEnv } from "../types/env.js";
import type {
  SiteConfig,
  SiteResolveHint,
  SiteRoutingConfig,
  SiteRoutingResolver,
} from "../types/multi-site.js";
import { aliasOnly, regionOnly } from "./site-id.js";

export interface UmbracoCloudRoutingOptions {
  /**
   * OAuth client_id registered in each Cloud project (e.g. "mcp-cms-editor").
   * Same value across every project for a given MCP type.
   */
  oauthClientId: string;
  /**
   * Cloud region used to build the project URL (`{alias}.{region}.umbraco.io`)
   * for a `siteId` with no region embedded (legacy bare-alias URLs). Defaults
   * to `env.UMBRACO_CLOUD_REGION` at request time, or `"euwest01"` when
   * neither option nor env var is set. Never consulted for a `siteId` that
   * already carries `<alias>.<region>` — that resolves directly instead.
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
   * Override the default validation. The default GETs
   * `https://{alias}.{region}.umbraco.io/umbraco` and sorts the result into
   * three outcomes (see `defaultValidateProject`): under 400 is "exists", a 5xx
   * or 429 is "unreachable" (throws), and any other 4xx is "missing". A probe
   * that gets no answer at all (timeout or other fetch error) is "unreachable"
   * for a site this deployment has resolved before, or one the caller holds a
   * sign-in for, and "missing" otherwise, because that is also all Cloud
   * returns for an alias that doesn't exist.
   * That no-answer handling applies to the default only; any throw from a
   * custom validator surfaces as 502.
   *
   * Return `true` to allow the project, `false` to reject (the router
   * surfaces this as 404). Throw to surface 502; the throw is cached for the
   * `error` TTL.
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
// Cap for the per-isolate cache and the `seen` set. At the cap the cache
// evicts expired entries and then the oldest; `seen` is simply cleared (its KV
// markers remain). Stops a stream of unique aliases (typos, scans) from
// growing either without bound.
const MAX_CACHE_ENTRIES = 1_000;
// Marks a site this deployment has resolved in the last 30 days (rewritten the
// first time each isolate resolves the site). Kept in KV as well as the
// per-isolate `seen` set, so a fresh isolate can still tell a known site that
// has stopped answering from an alias that never existed.
const SEEN_KEY_PREFIX = "cloud_site_seen:";
const SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// The marker is keyed on the project's host (`<alias>.<region>`, lowercased),
// not on the siteId as typed: `/at/proj` and `/at/proj.euwest01` are the same
// site and must share one marker, and hostnames ignore case.
const SEEN_HOST_PATTERN = /^([a-z0-9-]{1,63}\.[a-z0-9]{1,63})\.umbraco\.io$/;

/** KV key of a site's seen-marker, or `null` for a URL that never gets one. */
function seenKey(baseUrl: string): string | null {
  let host: string;
  try {
    const url = new URL(baseUrl);
    // An id like `user@abc` parses as host `abc`; it isn't that site's id.
    if (url.username || url.password) return null;
    host = url.hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = SEEN_HOST_PATTERN.exec(host);
  return match ? SEEN_KEY_PREFIX + match[1] : null;
}

/**
 * Thrown by `defaultValidateProject` when the probe got no HTTP answer
 * (timeout, DNS or connection failure). On its own that can't tell a site that
 * is down from an alias that doesn't exist. Observed 17-11-2026:
 * `*.{region}.umbraco.io` is a wildcard, and Cloud's edge held a request for
 * an unknown alias for about 20s before answering 522, well past the probe's
 * timeout.
 */
class SiteProbeNoAnswerError extends Error {
  constructor(readonly causeName: string) {
    super(`site probe failed: ${causeName}`);
  }
}

type CacheEntry =
  | { kind: "ok"; site: SiteConfig; expiresAt: number }
  | { kind: "miss"; expiresAt: number }
  | { kind: "error"; error: unknown; expiresAt: number }
  // The probe got no answer. Whether that means "unreachable" or "missing"
  // depends on who asks (see `answer`), so one entry serves every caller and
  // none of them overwrites another's reading of it.
  | {
      kind: "no-answer";
      error: SiteProbeNoAnswerError;
      /** The site's seen-marker key, or `null` if it can't have one. */
      markerKey: string | null;
      /** Whether the site has no seen-marker; looked up once, on first need. */
      unseen?: Promise<boolean>;
      /** End of the `error` TTL: after this, a caller that reads it as "unreachable" probes again. */
      retryAt: number;
      /** End of the `miss` TTL, for callers that read it as "missing". */
      expiresAt: number;
    };

type NoAnswerEntry = Extract<CacheEntry, { kind: "no-answer" }>;

/**
 * Build a `SiteRoutingConfig` preconfigured for Umbraco Cloud.
 */
export function umbracoCloudSiteRouting(
  options: UmbracoCloudRoutingOptions
): SiteRoutingConfig {
  const ttl = { ...DEFAULT_CACHE_TTL, ...options.cacheTtl };
  const cache = new Map<string, CacheEntry>();
  // One probe per site at a time: requests that arrive while it runs wait for
  // its result. Without this, a client retrying through an outage starts a new
  // 5s probe on every request until the first one fails and is cached.
  const inFlight = new Map<string, Promise<CacheEntry>>();
  // Marker keys of sites this isolate has resolved (`seen`) and has written to
  // KV (`persisted`): saves a KV read when one of them stops answering, and a
  // KV write per resolve. A failed write is taken back out of `persisted`, so
  // the next uncached resolve tries it again.
  const seen = new Set<string>();
  const persisted = new Set<string>();

  const markSeen = async (key: string | null, siteId: string, env: HostedMcpEnv): Promise<void> => {
    if (!key || persisted.has(key)) return;
    if (seen.size >= MAX_CACHE_ENTRIES) {
      seen.clear();
      persisted.clear();
    }
    seen.add(key);
    // Before the write, not after: a second resolve must not start its own.
    persisted.add(key);
    try {
      await env.OAUTH_KV.put(key, "1", { expirationTtl: SEEN_TTL_SECONDS });
    } catch (err) {
      persisted.delete(key);
      // Best effort: without the marker, a no-answer probe in another isolate
      // reads as "missing".
      console.warn(
        `site-probe site=${await siteRef(siteId, env)} seen-marker write failed: ${err instanceof Error ? err.name : "UnknownError"}`
      );
    }
  };

  const wasSeen = async (key: string | null, siteId: string, env: HostedMcpEnv): Promise<boolean> => {
    if (!key) return false;
    if (seen.has(key)) return true;
    try {
      return (await env.OAUTH_KV.get(key)) != null;
    } catch (err) {
      // We can't tell, so say "unreachable": retrying is harmless, a wrong 404 isn't.
      console.warn(
        `site-probe site=${await siteRef(siteId, env)} seen-marker read failed: ${err instanceof Error ? err.name : "UnknownError"}`
      );
      return true;
    }
  };

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

  /** Whether a no-answer site has no seen-marker. Looked up once per entry. */
  const isUnseen = (entry: NoAnswerEntry, siteId: string, env: HostedMcpEnv): Promise<boolean> =>
    (entry.unseen ??= (async () => {
      if (await wasSeen(entry.markerKey, siteId, env)) return false;
      console.log(
        `site-probe site=${await siteRef(siteId, env)} no-answer unseen cause=${entry.error.causeName}`
      );
      return true;
    })());

  /**
   * A no-answer probe means "unreachable" for a signed-in caller (its sign-in
   * shows the site existed) and for a site with a seen-marker. With neither,
   * the alias is treated as nonexistent.
   */
  const readsAsMissing = async (
    entry: NoAnswerEntry,
    siteId: string,
    env: HostedMcpEnv,
    hint: SiteResolveHint | undefined
  ): Promise<boolean> => !hint?.signedIn && (await isUnseen(entry, siteId, env));

  /** Whether a cached entry still answers this caller without a new probe. */
  const isFresh = async (
    entry: CacheEntry,
    siteId: string,
    env: HostedMcpEnv,
    hint: SiteResolveHint | undefined
  ): Promise<boolean> => {
    const now = Date.now();
    if (entry.expiresAt <= now) return false;
    if (entry.kind !== "no-answer" || now < entry.retryAt) return true;
    // Past the `error` TTL: only a "missing" reading keeps the longer `miss` TTL.
    return readsAsMissing(entry, siteId, env, hint);
  };

  const answer = async (
    entry: CacheEntry,
    siteId: string,
    env: HostedMcpEnv,
    hint: SiteResolveHint | undefined
  ): Promise<SiteConfig | null> => {
    switch (entry.kind) {
      case "ok":
        return entry.site;
      case "miss":
        return null;
      case "error":
        // The validator's own error, so a caller sees the same thing whether
        // or not the cache answered.
        throw entry.error;
      case "no-answer":
        if (await readsAsMissing(entry, siteId, env, hint)) return null;
        throw entry.error;
    }
  };

  /** Probes the site and caches the outcome. Every TTL counts from when the probe ended. */
  const probe = async (siteId: string, env: HostedMcpEnv): Promise<CacheEntry> => {
    const validator = options.validateProject ?? defaultValidateProject;

    // `<alias>.<region>` embedded in siteId (Cloud's own hostname shape) is
    // authoritative — the host below already ends up region-qualified
    // (e.g. siteId "abc.uksouth01" -> "abc.uksouth01.umbraco.io"), so no
    // region needs appending and no guessing happens. A bare alias (no
    // embedded region) gets the single default region appended instead.
    const embeddedRegion = regionOnly(siteId);
    const resolvedRegion = embeddedRegion ?? options.region ?? env.UMBRACO_CLOUD_REGION ?? DEFAULT_REGION;
    const candidateUrl = embeddedRegion
      ? `https://${siteId}.umbraco.io`
      : `https://${siteId}.${resolvedRegion}.umbraco.io`;

    const store = (entry: CacheEntry): CacheEntry => {
      setCache(siteId, entry);
      return entry;
    };

    let exists: boolean;
    try {
      exists = await validator(siteId, candidateUrl, env);
    } catch (err) {
      // Counted from when the probe failed: a probe that ran into its own 5s
      // timeout would otherwise use up half the TTL.
      const end = Date.now();
      if (err instanceof SiteProbeNoAnswerError) {
        return store({
          kind: "no-answer",
          error: err,
          markerKey: seenKey(candidateUrl),
          retryAt: end + ttl.error,
          expiresAt: end + Math.max(ttl.error, ttl.miss),
        });
      }
      return store({ kind: "error", error: err, expiresAt: end + ttl.error });
    }

    if (!exists) {
      return store({ kind: "miss", expiresAt: Date.now() + ttl.miss });
    }

    const oauthClientSecret = options.resolveOauthClientSecret
      ? (await options.resolveOauthClientSecret(siteId, env)) ?? undefined
      : undefined;

    const site: SiteConfig = {
      id: siteId,
      displayName: siteId,
      baseUrl: candidateUrl,
      oauthClientId: options.oauthClientId,
      // The Cloud project's own OAuth client registration only knows its
      // bare alias (see `SiteConfig.callbackId` doc) — send that as the
      // callback path even though `id` carries the region for our own
      // routing/resolution purposes.
      ...(embeddedRegion ? { callbackId: aliasOnly(siteId) } : {}),
      // Carried separately from `id` (see `SiteConfig.region` doc) — a bare
      // alias's *effective* region for telemetry, without changing `id`
      // itself, so tenant/login-session hashes (keyed on `id`) stay stable.
      region: resolvedRegion,
      ...(oauthClientSecret ? { oauthClientSecret } : {}),
    };

    // Cached before the marker write, so that write delays no later request.
    const entry = store({ kind: "ok", site, expiresAt: Date.now() + ttl.ok });
    // Only the default validator's no-answer outcome ever reads the marker.
    if (!options.validateProject) await markSeen(seenKey(candidateUrl), siteId, env);
    return entry;
  };

  const resolveSite: SiteRoutingResolver = async (siteId, env, hint) => {
    // Defense in depth — the primary gates live in `createWorkerExport` /
    // `createDefaultHandler`, which consult the same `enabled` predicate
    // exposed below and short-circuit before this resolver is invoked.
    if (!enabled(env)) {
      return null;
    }

    let entry = cache.get(siteId);
    if (!entry || !(await isFresh(entry, siteId, env, hint))) {
      let pending = inFlight.get(siteId);
      if (!pending) {
        pending = probe(siteId, env).finally(() => inFlight.delete(siteId));
        inFlight.set(siteId, pending);
      }
      entry = await pending;
    }
    return answer(entry, siteId, env, hint);
  };

  return {
    pathPrefix: options.pathPrefix ?? DEFAULT_PATH_PREFIX,
    resolveSite,
    enabled,
  };
}

/**
 * Default validator — GETs `/umbraco` on the Cloud host and sorts the result
 * into three outcomes. Under 400 is "exists" (`true`). A 5xx or 429 is
 * "unreachable": it throws, with the status in the message. Any other 4xx
 * (404, 401, 403, ...) is "missing" (`false`). A timeout or any other thrown
 * fetch error throws a `SiteProbeNoAnswerError` carrying the error's `name`
 * (never its message, which can carry the hostname), and so does one of
 * Cloudflare's origin-unreachable statuses (520-527, 530); `resolveSite` reports
 * that as "unreachable" for a site resolved before or a signed-in caller, and
 * as "missing" otherwise.
 * An alias that can't form a valid hostname is "missing" too (`false`, logged
 * as `invalid-host`) and is never fetched. (HEAD looks tempting but Cloud's edge returns 404 for HEAD on this path.)
 */
async function defaultValidateProject(
  siteId: string,
  baseUrl: string,
  env: HostedMcpEnv
): Promise<boolean> {
  let probeUrl: string;
  try {
    probeUrl = new URL("/umbraco", baseUrl).toString();
  } catch {
    // An alias that can never be a hostname: the site can't exist.
    console.log(`site-probe site=${await siteRef(siteId, env)} invalid-host`);
    return false;
  }
  let status: number;
  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    response.body?.cancel();
    status = response.status;
  } catch (err) {
    throw new SiteProbeNoAnswerError(err instanceof Error ? err.name : "UnknownError");
  }
  if (status < 400) return true;
  // Cloudflare's own "the origin didn't answer" statuses. The edge sent them,
  // not the site, so they say no more than a timeout does. Today the edge
  // takes about 20s to send one and the probe gives up first, but the outcome
  // mustn't depend on which of the two is quicker.
  if ((status >= 520 && status <= 527) || status === 530) {
    throw new SiteProbeNoAnswerError(`status=${status}`);
  }
  if (status >= 500 || status === 429) {
    throw new Error(`site probe failed: status=${status}`);
  }
  console.log(`site-probe site=${await siteRef(siteId, env)} status=${status}`);
  return false;
}
