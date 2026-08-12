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

import type { HostedMcpEnv } from "../types/env.js";

/** Default name for the header when a value is configured but no name is. */
export const DEFAULT_UMBRACO_MCP_HEADER_NAME = "X-Umbraco-Mcp";

/**
 * Builds the firewall-allowlist header from env, or `{}` when
 * `UMBRACO_MCP_HEADER_VALUE` isn't set (the feature is opt-in).
 */
export function buildFirewallHeader(
  env: Pick<HostedMcpEnv, "UMBRACO_MCP_HEADER_NAME" | "UMBRACO_MCP_HEADER_VALUE">
): Record<string, string> {
  const { UMBRACO_MCP_HEADER_NAME: headerName, UMBRACO_MCP_HEADER_VALUE: headerValue } = env;
  return headerValue ? { [headerName || DEFAULT_UMBRACO_MCP_HEADER_NAME]: headerValue } : {};
}
