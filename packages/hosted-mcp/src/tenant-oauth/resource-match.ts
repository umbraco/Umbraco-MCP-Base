/**
 * Validation for the OAuth `resource` parameter against the canonical PRM
 * value (`${origin}/at/<alias>`).
 *
 * Rules:
 * - `undefined` / `""` → ok (caller synthesises canonical).
 * - Single string equal to canonical, or to one of its accepted spellings
 *   (see `isCanonicalSpelling`) → ok.
 * - Array containing exactly one accepted entry → ok.
 * - Anything else → reject. In particular, a multi-element array is rejected
 *   even if one element matches canonical, because additional entries become
 *   extra audience claims on the issued token (OAuthProvider preserves the
 *   full array into the grant and audience matching is .some()-based, so
 *   any extra value would let the token reach a sibling tenant).
 *
 * Accepted spellings are limited to the same tenant on the same origin:
 * the bare canonical value, a trailing slash, and the MCP endpoint itself
 * (`/mcp`, with or without trailing slash). The MCP spec tells clients to send
 * the MCP server URL as `resource`, and that URL is `${canonical}/mcp` (issue
 * #308). Scheme, host, alias and any other path suffix must still match
 * byte-for-byte. The caller always forwards the bare canonical value to
 * OAuthProvider, so the accepted spelling never reaches the token audience.
 */
export type ResourceMatchResult = { ok: true } | { ok: false; reason: string };

export function validateResourceMatch(
  sent: string | string[] | undefined,
  canonical: string
): ResourceMatchResult {
  if (sent === undefined || sent === "") {
    return { ok: true };
  }
  if (typeof sent === "string") {
    if (isCanonicalSpelling(sent, canonical)) return { ok: true };
    return mismatch(canonical);
  }
  // Array: every entry must be canonical. A single-element array of the
  // canonical value is also fine. Multi-valued resource at a tenant-prefixed
  // endpoint is always a misuse (RFC 8707 single-target convention) so we
  // reject even when one element matches.
  if (sent.length === 0) return { ok: true };
  if (sent.length > 1) return mismatch(canonical);
  if (isCanonicalSpelling(sent[0], canonical)) return { ok: true };
  return mismatch(canonical);
}

/**
 * The spellings of the canonical tenant resource we treat as equal to it.
 * Exact string comparison only — no URL parsing, no case folding.
 */
export function isCanonicalSpelling(sent: string, canonical: string): boolean {
  return (
    sent === canonical ||
    sent === `${canonical}/` ||
    sent === `${canonical}/mcp` ||
    sent === `${canonical}/mcp/`
  );
}

function mismatch(canonical: string): ResourceMatchResult {
  return {
    ok: false,
    reason: `resource parameter does not match site URL (expected "${canonical}" or "${canonical}/mcp")`,
  };
}
