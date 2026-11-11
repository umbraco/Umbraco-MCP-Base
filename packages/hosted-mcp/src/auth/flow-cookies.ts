/**
 * Browser-bound authorization flow cookies.
 *
 * The consent form and the Umbraco callback each carry a one-time `state`
 * value that is also stored server-side in KV. These helpers bind that value
 * to the browser that started the flow, by setting it in a cookie and
 * requiring the cookie to match when the value comes back:
 *
 * - `consent`: set when the consent screen is shown, checked when the
 *   consent form is submitted.
 * - `state`: set on the redirect to Umbraco (immediately after consent is
 *   approved), checked at `/callback`.
 *
 * Follows the MCP Security Best Practices (2025-11-25) cookie requirements:
 * `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, server-side session
 * (the cookie only holds a random value that must also exist in KV).
 *
 * `SameSite=Lax` (not `Strict`) is required: the return from Umbraco to
 * `/callback` is a cross-site top-level navigation, which Lax cookies survive.
 *
 * The cookie name includes a short prefix of the value so that two flows in
 * the same browser (e.g. two MCP clients connecting at once) don't overwrite
 * each other.
 */

import { constantTimeEqual } from "../crypto/constant-time.js";

export type FlowCookieKind = "consent" | "state";

/** Cookie lifetime in seconds — matches the 10-minute KV state TTL. */
export const FLOW_COOKIE_MAX_AGE = 600;

const NAME_ID_LENGTH = 16;
const NAME_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Raised when a flow value arrives without a matching browser cookie.
 * Callers map this to a 403 response.
 */
export class FlowBindingError extends Error {
  readonly status = 403;

  constructor(message = "This sign-in request was not started in this browser") {
    super(message);
    this.name = "FlowBindingError";
  }
}

/**
 * Returns the cookie name for a flow value, or `null` if the value can't
 * safely be used to derive one (values are random hex in practice).
 */
export function flowCookieName(kind: FlowCookieKind, value: string): string | null {
  const id = value.slice(0, NAME_ID_LENGTH);
  if (!id || !NAME_ID_PATTERN.test(id)) return null;
  return `__Host-mcp_${kind}_${id}`;
}

/** `Set-Cookie` header value that binds `value` to this browser. */
export function setFlowCookieHeader(kind: FlowCookieKind, value: string): string {
  const name = flowCookieName(kind, value);
  if (!name) {
    throw new Error("Flow value is not usable as a cookie identifier");
  }
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${FLOW_COOKIE_MAX_AGE}`;
}

/** `Set-Cookie` header value that removes the cookie for `value`, or `null` if none can exist. */
export function clearFlowCookieHeader(kind: FlowCookieKind, value: string): string | null {
  const name = flowCookieName(kind, value);
  if (!name) return null;
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * True when the request carries the flow cookie for `value` and its content
 * equals `value` exactly (constant-time comparison).
 */
export function hasMatchingFlowCookie(
  request: Request,
  kind: FlowCookieKind,
  value: string
): boolean {
  const name = flowCookieName(kind, value);
  if (!name) return false;
  const cookieValue = readCookie(request, name);
  return cookieValue !== null && constantTimeEqual(cookieValue, value);
}

/**
 * Returns a copy of `response` with the given `Set-Cookie` headers appended.
 * Copies rather than mutating, because `Response.redirect()` and some
 * runtime responses have immutable headers.
 */
export function withSetCookies(response: Response, cookies: Array<string | null>): Response {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) {
    if (cookie) headers.append("Set-Cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 302 redirect with mutable headers (unlike `Response.redirect`). */
export function redirectResponse(location: string, cookies: Array<string | null> = []): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) {
    if (cookie) headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

/**
 * True when a form submission comes from another site, using Fetch Metadata
 * (`Sec-Fetch-Site`) and falling back to `Origin` for clients that don't send it.
 * Requests with neither header are allowed through: the cookie check still applies.
 */
export function isCrossSiteSubmission(request: Request, expectedOrigin: string): boolean {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite) {
    return fetchSite !== "same-origin";
  }
  const origin = request.headers.get("Origin");
  if (origin) {
    return origin !== expectedOrigin;
  }
  return false;
}

// ============================================================================
// Internal helpers
// ============================================================================

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}
