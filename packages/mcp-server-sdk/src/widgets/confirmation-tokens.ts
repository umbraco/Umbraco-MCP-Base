/**
 * In-memory one-shot tokens that bind a widget's confirmation result back
 * to the call that issued it. Mitigates the simplest LLM-replay path:
 *
 *   tool({ id, confirmed: true })   ← LLM bypasses the widget entirely
 *
 * The widget branch of `createConfirmedToolDefinition` issues a token, the
 * widget echoes it back as `confirmationToken` alongside `confirmed: true`,
 * and the wrapper validates + consumes the token before running the real
 * handler. A token is bound to the exact args it was issued for, can only
 * be consumed once, and expires after a short TTL.
 *
 * This is best-effort, not airtight. A sufficiently determined LLM can
 * read `structuredContent.token` from the intermediate tool result and
 * replay it before the iframe gets a chance to. Closing that gap fully
 * needs either an MCP Apps spec evolution (widget-only response channel)
 * or per-host attestation we can't synthesize here. The token system
 * still raises the bar meaningfully:
 *
 * - One-shot: a replayed token after the user clicks Accept fails.
 * - Args-bound: the LLM can't reuse a token from one call against
 *   different inputs (e.g. swapping the id it deletes).
 * - Expiring: stale tokens drop, so a long-lived chat session can't
 *   accumulate confirmation grants.
 */

import { randomUUID } from "node:crypto";

interface TokenEntry {
  argsKey: string;
  expiresAt: number;
}

const tokens = new Map<string, TokenEntry>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

let _ttlMs = DEFAULT_TTL_MS;

/**
 * Override the token TTL for tests. Returns to the default when called
 * with no argument.
 */
export function setConfirmationTokenTtlMs(ttlMs?: number): void {
  _ttlMs = ttlMs ?? DEFAULT_TTL_MS;
}

/**
 * Issue a fresh token bound to the given args. The widget will be expected
 * to pass this token back as `confirmationToken` when re-entering the tool
 * with `confirmed: true`.
 */
export function issueConfirmationToken(args: unknown): string {
  evictExpired();
  const token = randomUUID();
  tokens.set(token, {
    argsKey: stableStringify(args),
    expiresAt: Date.now() + _ttlMs,
  });
  return token;
}

/**
 * Validate and consume a token. Returns `true` only when the token
 * exists, hasn't expired, and was issued for exactly these args. The
 * token is removed from the store either way (one-shot semantics).
 */
export function consumeConfirmationToken(
  token: unknown,
  args: unknown,
): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const entry = tokens.get(token);
  if (!entry) return false;
  tokens.delete(token);
  if (entry.expiresAt < Date.now()) return false;
  return entry.argsKey === stableStringify(args);
}

/**
 * Drop all tokens. Test-only escape hatch.
 */
export function clearConfirmationTokens(): void {
  tokens.clear();
}

/**
 * Number of currently-valid tokens. Test-only escape hatch.
 */
export function confirmationTokenStoreSize(): number {
  evictExpired();
  return tokens.size;
}

function evictExpired(): void {
  const now = Date.now();
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(token);
  }
}

/**
 * Deterministic JSON stringify so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`
 * compare equal — the LLM and the widget may serialize argument keys in
 * different orders.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}
