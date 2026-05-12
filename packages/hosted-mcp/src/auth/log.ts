/**
 * Auth diagnostics — gated `[mcp-auth]` logging.
 *
 * Off by default; flip on by setting `LOG_AUTH=true` (or `"1"`) via
 * `wrangler secret put LOG_AUTH`. Then tail with
 * `wrangler tail <worker> | grep mcp-auth`.
 *
 * Kept as a no-op when the flag is unset so production deploys don't pay
 * the per-request log cost.
 */

import type { HostedMcpEnv } from "../types/env.js";

const TRUTHY = new Set(["true", "1", "yes", "on"]);

function isEnabled(env: HostedMcpEnv | { LOG_AUTH?: string } | undefined): boolean {
  const v = env?.LOG_AUTH;
  return typeof v === "string" && TRUTHY.has(v.toLowerCase());
}

/**
 * Logs an `[mcp-auth]`-prefixed line when `env.LOG_AUTH` is truthy.
 *
 * Accepts an env-shaped object so callers without the full HostedMcpEnv
 * (e.g. only `{ LOG_AUTH }` peeked from a partial context) can still call.
 */
export function logAuth(
  env: HostedMcpEnv | { LOG_AUTH?: string } | undefined,
  message: string
): void {
  if (!isEnabled(env)) return;
  console.log(`[mcp-auth] ${message}`);
}
