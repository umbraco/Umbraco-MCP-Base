/**
 * Strict-equality validation for the OAuth `resource` parameter against the
 * canonical PRM value (`${origin}/at/<alias>`).
 *
 * No normalisation: trailing slashes, path suffixes, scheme/host variants are
 * all rejected. Clients that walk PRM correctly send the canonical form;
 * variants signal a confused or malicious client.
 *
 * `undefined` and `""` are treated as "absent" — the caller synthesises the
 * canonical value and the issued token's `aud` is set correctly without the
 * client having to send anything. Returning {ok:true} on absent simplifies
 * the call site (one branch for valid, one for invalid).
 */
export type ResourceMatchResult = { ok: true } | { ok: false; reason: string };

export function validateResourceMatch(
  sent: string | string[] | undefined,
  canonical: string
): ResourceMatchResult {
  if (sent === undefined || sent === "") {
    return { ok: true };
  }
  const values = Array.isArray(sent) ? sent : [sent];
  for (const v of values) {
    if (v === canonical) return { ok: true };
  }
  return {
    ok: false,
    reason: `resource parameter does not match site URL (expected exactly "${canonical}")`,
  };
}
