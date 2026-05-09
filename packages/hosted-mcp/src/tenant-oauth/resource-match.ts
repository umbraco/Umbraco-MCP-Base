/**
 * Strict-equality validation for the OAuth `resource` parameter against the
 * canonical PRM value (`${origin}/at/<alias>`).
 *
 * Rules:
 * - `undefined` / `""` → ok (caller synthesises canonical).
 * - Single string equal to canonical → ok.
 * - Array containing exactly one entry equal to canonical → ok.
 * - Anything else → reject. In particular, a multi-element array is rejected
 *   even if one element matches canonical, because additional entries become
 *   extra audience claims on the issued token (OAuthProvider preserves the
 *   full array into the grant and audience matching is .some()-based, so
 *   any extra value would let the token reach a sibling tenant).
 *
 * No normalisation: trailing slashes, path suffixes, scheme/host variants are
 * all rejected. Clients that walk PRM correctly send the canonical form;
 * variants signal a confused or malicious client.
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
    if (sent === canonical) return { ok: true };
    return mismatch(canonical);
  }
  // Array: every entry must be canonical. A single-element array of the
  // canonical value is also fine. Multi-valued resource at a tenant-prefixed
  // endpoint is always a misuse (RFC 8707 single-target convention) so we
  // reject even when one element matches.
  if (sent.length === 0) return { ok: true };
  if (sent.length > 1) return mismatch(canonical);
  if (sent[0] === canonical) return { ok: true };
  return mismatch(canonical);
}

function mismatch(canonical: string): ResourceMatchResult {
  return {
    ok: false,
    reason: `resource parameter does not match site URL (expected exactly "${canonical}")`,
  };
}
