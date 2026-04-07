/**
 * Server Reference
 *
 * Module-scoped reference to the MCP Server instance for tools that need
 * server-level capabilities like elicitation.
 *
 * Set once during server initialization:
 * - Stdio mode: in index.ts at startup via setServerRef(server.server)
 * - Hosted mode: in worker.ts DO init() via setServerRef(this.server.server)
 *
 * DOs are single-threaded so a module-scoped ref is safe per instance.
 * This is equivalent to Cloudflare's `this.server.server` closure pattern
 * but works with tools defined in separate files.
 *
 * @example
 * ```typescript
 * // In index.ts or worker.ts:
 * import { setServerRef } from "@umbraco-cms/mcp-server-sdk";
 * setServerRef(server.server);
 *
 * // In a tool handler:
 * import { getServerRef } from "@umbraco-cms/mcp-server-sdk";
 * const server = getServerRef();
 * await server.elicitInput({ message: "Confirm?", ... });
 * ```
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

let _server: Server | null = null;

/**
 * Store the MCP Server instance for use by tools.
 * Call once during server initialization.
 *
 * @param server - The underlying Server instance (McpServer.server)
 */
export function setServerRef(server: Server): void {
  _server = server;
}

/**
 * Get the stored MCP Server instance.
 * Throws if not yet set — call setServerRef() during initialization first.
 *
 * @returns The Server instance
 * @throws Error if setServerRef() has not been called
 */
export function getServerRef(): Server {
  if (!_server) {
    throw new Error(
      "Server reference not set. Call setServerRef(server.server) during initialization."
    );
  }
  return _server;
}

/**
 * Clear the server reference. Useful for testing.
 */
export function clearServerRef(): void {
  _server = null;
}
