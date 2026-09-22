/**
 * Shared log-sanitisation helper.
 *
 * Strips control characters so a user- or upstream-tainted value can't forge a
 * log line (e.g. on `wrangler tail`) or a problem body handed back to an MCP
 * client. Used by both the auth/token-refresh path and per-request server
 * creation, which is why it lives here rather than in either.
 */
export function sanitizeForLog(value: unknown): string {
  if (value === null || value === undefined) return "<none>";
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\x00-\x1F\x7F]/g, "?");
}
