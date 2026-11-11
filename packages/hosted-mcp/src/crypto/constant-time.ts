/**
 * Constant-Time String Comparison
 *
 * One place for comparing secrets (flow cookies, session tags) without
 * leaking, through timing, how much of the value matched.
 */

/** True when `a` and `b` are the same string. Runs in time that depends only on their length. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
