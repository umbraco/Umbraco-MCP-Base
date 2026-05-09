/**
 * Path prefix helpers for URL-based site routing.
 *
 * A pathPrefix like "/at/:siteId" parses into a regex that matches the
 * MCP endpoint URL (`/at/{alias}/`) and extracts the site identifier.
 */

const PARAM_PATTERN = /:[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Compile a pathPrefix string into a RegExp that matches the MCP endpoint
 * (prefix + optional trailing slash) and captures the site identifier.
 *
 * Example: "/at/:siteId" → /^\/at\/([^/]+)\/?$/
 */
export function buildPrefixRegex(pathPrefix: string): RegExp {
  if (!pathPrefix.startsWith("/")) {
    throw new Error(`pathPrefix must start with "/": ${pathPrefix}`);
  }

  const params: string[] = [];
  const escaped = pathPrefix
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(PARAM_PATTERN, (match) => {
      params.push(match.slice(1));
      return "([^/]+)";
    });

  if (params.length !== 1) {
    throw new Error(
      `pathPrefix must contain exactly one parameter (e.g. ":siteId"): ${pathPrefix}`
    );
  }

  return new RegExp(`^${escaped}\\/?$`);
}

/**
 * Extract the site identifier from a request pathname using the prefix regex.
 * Returns null when the pathname does not match the prefix.
 */
export function extractSiteIdFromPath(
  pathname: string,
  prefixRegex: RegExp
): string | null {
  const match = pathname.match(prefixRegex);
  return match?.[1] ?? null;
}

/**
 * Extract the site identifier from an OAuth `resource` parameter.
 *
 * The MCP client is supposed to set `resource` to its server URL, e.g.
 * `https://mcp.example.com/at/my-project/`. We pull out the matching path
 * segment using the same prefix regex.
 *
 * Accepts the array form of `resource` (per the OAuth spec) and returns the
 * first siteId we can extract.
 */
export function extractSiteIdFromResource(
  resource: string | string[] | undefined,
  prefixRegex: RegExp
): string | null {
  if (!resource) return null;
  const values = Array.isArray(resource) ? resource : [resource];
  for (const value of values) {
    const siteId = extractSiteIdFromOneResource(value, prefixRegex);
    if (siteId) return siteId;
  }
  return null;
}

/**
 * Like `extractSiteIdFromResource` but returns EVERY siteId extractable from
 * the (possibly array-valued) resource parameter. Used for defence-in-depth
 * checks that must reject when a multi-valued `resource` carries audiences
 * for tenants other than the registered one.
 */
export function extractAllSiteIdsFromResource(
  resource: string | string[] | undefined,
  prefixRegex: RegExp
): string[] {
  if (!resource) return [];
  const values = Array.isArray(resource) ? resource : [resource];
  const out: string[] = [];
  for (const value of values) {
    const siteId = extractSiteIdFromOneResource(value, prefixRegex);
    if (siteId) out.push(siteId);
  }
  return out;
}

function extractSiteIdFromOneResource(
  value: string,
  prefixRegex: RegExp
): string | null {
  let pathname: string;
  try {
    pathname = new URL(value).pathname;
  } catch {
    pathname = value.startsWith("/") ? value : `/${value}`;
  }
  return extractSiteIdFromPath(pathname, prefixRegex);
}
