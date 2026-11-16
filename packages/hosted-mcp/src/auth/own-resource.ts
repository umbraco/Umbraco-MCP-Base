/**
 * The OAuth `resource` (RFC 8707) for a Worker that serves one MCP endpoint
 * on its own origin: single-site and static multi-site deployments. URL-based
 * site routing has one resource per tenant and is handled in `tenant-oauth/`.
 *
 * Every grant is given a resource, so every access token carries an audience
 * the OAuth provider checks on each MCP request:
 * - `/authorize` keeps the resource the client sent when it is on this
 *   origin, and defaults to the origin when the client sent none.
 * - `/token` drops a same-origin `resource` from the request, so the token
 *   takes the grant's resource. The provider compares the two values exactly,
 *   and a client that omits `resource` at `/authorize` but sends its MCP URL
 *   at `/token` would otherwise be refused.
 */

function isOnOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function asList(resource: string | string[] | undefined): string[] {
  if (!resource) return [];
  return Array.isArray(resource) ? resource : [resource];
}

/** True when every `resource` value is a URL on `origin` (or none was sent). */
export function resourceIsOnOrigin(
  resource: string | string[] | undefined,
  origin: string
): boolean {
  return asList(resource).every((value) => isOnOrigin(value, origin));
}

/** The resource to record on the grant: the client's own, or this origin. */
export function grantResource(
  resource: string | string[] | undefined,
  origin: string
): string | string[] {
  return asList(resource).length > 0 ? resource! : origin;
}

/**
 * Returns the `/token` request with a same-origin `resource` removed from its
 * form body. A request with no `resource`, or with any value on another
 * origin, is returned unchanged for the provider to judge.
 */
export async function dropOwnOriginResource(request: Request): Promise<Request> {
  if (request.method !== "POST") return request;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) return request;

  const form = new URLSearchParams(await request.clone().text());
  const sent = form.getAll("resource");
  const origin = new URL(request.url).origin;
  if (sent.length === 0 || !sent.every((value) => isOnOrigin(value, origin))) {
    return request;
  }
  form.delete("resource");

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: form.toString(),
  });
}
