import type { HostedMcpEnv } from "../types/env.js";

export const DEFAULT_MCP_HEADER_NAME = "X-Umbraco-Mcp";

/**
 * Builds the optional identifying header sent on every server-side request to
 * Umbraco (so a firewall allow-rule can recognise MCP traffic). Returns an
 * empty object when `UMBRACO_MCP_HEADER_VALUE` is unset (feature off).
 */
export function buildMcpHeader(
  env: Pick<HostedMcpEnv, "UMBRACO_MCP_HEADER_NAME" | "UMBRACO_MCP_HEADER_VALUE"> | undefined
): Record<string, string> {
  if (!env?.UMBRACO_MCP_HEADER_VALUE) return {};
  return {
    [env.UMBRACO_MCP_HEADER_NAME || DEFAULT_MCP_HEADER_NAME]: env.UMBRACO_MCP_HEADER_VALUE,
  };
}
