/**
 * `resource_metadata` URLs for the `WWW-Authenticate` header on 401s from the
 * protected MCP endpoint.
 *
 * Shared by the two places that put one on the wire, so they can't drift:
 * - `createWorkerExport` (worker-entry.ts), which patches OAuthProvider's own
 *   401s for `/at/<alias>/...` paths (issue #103), and
 * - `createSiteRoutingApiHandler` (site-router.ts), which 401s an authenticated
 *   request whose inner Umbraco token entry is gone (issue #371).
 */

const PRM_PATH = "/.well-known/oauth-protected-resource";

/** Root protected-resource-metadata URL for the request's origin. */
function rootPrmUrl(url: URL): string {
  return `${url.origin}${PRM_PATH}`;
}

/**
 * Tenant-pinned PRM URL for a `/at/<alias>/...` request, or `null` when the
 * request is not tenant-scoped.
 */
function tenantPrmUrl(url: URL): string | null {
  const match = url.pathname.match(/^\/at\/([^/]+)\//);
  return match ? `${url.origin}${PRM_PATH}/at/${match[1]}` : null;
}

/**
 * Rewrites a `resource_metadata` value the way `createWorkerExport` does for
 * OAuthProvider's 401s: a root PRM URL on a `/at/<alias>/...` request becomes
 * the tenant PRM URL. Any other value is returned unchanged.
 */
export function rewriteResourceMetadataForTenant(value: string, requestUrl: string | URL): string {
  const url = new URL(requestUrl);
  const tenant = tenantPrmUrl(url);
  return tenant && value === rootPrmUrl(url) ? tenant : value;
}

/**
 * The `resource_metadata` value a client sees on OAuthProvider's own 401 for
 * this request: the provider's formula (`<origin>/.well-known/oauth-protected-resource<pathname>`,
 * as `@cloudflare/workers-oauth-provider` builds it in `handleApiRequest`)
 * passed through the same tenant rewrite `createWorkerExport` applies.
 */
export function resourceMetadataUrlFor(requestUrl: string | URL): string {
  const url = new URL(requestUrl);
  return rewriteResourceMetadataForTenant(`${url.origin}${PRM_PATH}${url.pathname}`, url);
}
