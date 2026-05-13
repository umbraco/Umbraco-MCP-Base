/**
 * Gather chained tools
 *
 * Convenience helper for assembling the `availableChainedTools` set that
 * `shouldIncludeTool` consumes when filtering by `chainedDeps`. Queries one
 * or more connected chained MCP servers' `tools/list` and unions the names.
 *
 * The set is intentionally a `Set<string>` of tool names — name collisions
 * across multiple chained servers collapse, which matches how callers reason
 * about dep names (a wrapper's `chainedDeps: ["foo"]` is satisfied if *any*
 * connected chained server exposes a tool called `foo`).
 */

import type { McpClientManager } from "../mcp-client/manager.js";

/**
 * Call `tools/list` on each named chained server and return the union of
 * tool names that came back. Servers that fail are logged via `onError`
 * (default: `console.error`) and their tools omitted from the set.
 *
 * @param manager - The McpClientManager that already has the chained servers registered.
 * @param serverNames - Names of chained servers to query.
 * @param onError - Optional handler for per-server failures.
 * @returns A `Set<string>` of tool names suitable for `ToolFilterContext.availableChainedTools`.
 */
export async function gatherChainedTools(
  manager: McpClientManager,
  serverNames: readonly string[],
  onError: (serverName: string, error: unknown) => void = (name, err) =>
    console.error(`Warning: failed to list tools for chained server "${name}":`, err),
): Promise<Set<string>> {
  const available = new Set<string>();
  for (const name of serverNames) {
    try {
      const { tools } = await manager.listTools(name);
      for (const tool of tools) available.add(tool.name);
    } catch (err) {
      onError(name, err);
    }
  }
  return available;
}
