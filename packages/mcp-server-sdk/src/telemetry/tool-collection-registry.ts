/**
 * Tool → Collection Registry
 *
 * `withStandardDecorators` is applied in the tool's own file, where the owning
 * collection isn't known — collections are only assembled later, in the host's
 * registration loop. So the decorator can't read the collection off the tool,
 * and `ToolDefinition` deliberately isn't widened to carry a value every tool
 * author would have to repeat.
 *
 * Instead the registration loop, which does know both, records the mapping here
 * and `withTelemetry` looks it up at call time.
 *
 * Safe as module state: the mapping is static configuration decided at startup,
 * not per-request data, so sharing it across requests in a Worker isolate is
 * correct rather than a leak. (Contrast the version-check singleton, which
 * holds per-request results and must not be shared.)
 *
 * Entirely optional. A host that never calls `registerToolCollection` just
 * emits spans without the `umbraco.mcp.collection` attribute; nothing else
 * changes.
 */

const toolCollections = new Map<string, string>();

/**
 * Records which collection a tool belongs to.
 *
 * Call from the host's tool-registration loop, where both are in scope. Last
 * write wins, so re-registering the same tool (a Durable Object re-running
 * `init()` after a hibernation wake, say) is harmless.
 *
 * @param toolName - Registered tool name, as sent to the MCP client
 * @param collectionName - Owning collection's `metadata.name`
 */
export function registerToolCollection(toolName: string, collectionName: string): void {
  toolCollections.set(toolName, collectionName);
}

/**
 * Returns the collection a tool was registered under, or `undefined` if the
 * host never recorded one.
 */
export function getToolCollection(toolName: string): string | undefined {
  return toolCollections.get(toolName);
}

/** Drops all mappings. For tests, and for hosts that rebuild their tool set. */
export function clearToolCollections(): void {
  toolCollections.clear();
}
