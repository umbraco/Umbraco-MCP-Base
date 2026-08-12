/**
 * Firewall-allowlist header.
 *
 * Some Umbraco instances sit behind an IP allow-list firewall. Traffic from a
 * hosted Worker won't come from an allow-listed IP, so operators can set a
 * fixed, identifiable header on every server-side request and write a
 * firewall rule that lets it through.
 *
 * Kept in its own module (rather than alongside `createUmbracoFetchClient`)
 * because `auth/token-storage.ts` needs it too, and `umbraco-fetch-client.ts`
 * already imports from `token-storage.ts` — putting it there would be circular.
 */

import { DEFAULT_UMBRACO_MCP_HEADER_NAME } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";

export { DEFAULT_UMBRACO_MCP_HEADER_NAME };

// Control characters (CR/LF in particular) make `fetch` throw when building
// the Headers object. Rejecting them here means a misconfigured value fails
// loudly with a clear, actionable message pointing at the two env vars —
// rather than as an opaque `TypeError` deep inside `fetch`, or (as happened
// in `defaultValidateProject`'s broad try/catch before this check existed)
// as a silently swallowed failure with no trace of the real cause.
const INVALID_HEADER_CHARS = /[\x00-\x1F\x7F]/;

/**
 * Builds the firewall-allowlist header from env, or `{}` when
 * `UMBRACO_MCP_HEADER_VALUE` isn't set (the feature is opt-in) or the
 * configured name/value is unsafe to send as an HTTP header (logged instead
 * of thrown — see `INVALID_HEADER_CHARS`).
 */
export function buildFirewallHeader(
  env: Pick<HostedMcpEnv, "UMBRACO_MCP_HEADER_NAME" | "UMBRACO_MCP_HEADER_VALUE">
): Record<string, string> {
  const { UMBRACO_MCP_HEADER_NAME: headerName, UMBRACO_MCP_HEADER_VALUE: headerValue } = env;
  if (!headerValue) return {};
  const name = headerName || DEFAULT_UMBRACO_MCP_HEADER_NAME;
  if (INVALID_HEADER_CHARS.test(name) || INVALID_HEADER_CHARS.test(headerValue)) {
    console.error(
      "[mcp-hosted] UMBRACO_MCP_HEADER_NAME/UMBRACO_MCP_HEADER_VALUE contains a control character — e.g. a stray newline from a copy/paste — and will be omitted from requests to Umbraco."
    );
    return {};
  }
  return { [name]: headerValue };
}
