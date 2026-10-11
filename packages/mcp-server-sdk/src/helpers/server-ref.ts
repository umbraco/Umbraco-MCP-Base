/**
 * Server Reference
 *
 * Reference to the MCP Server instance for tools that need server-level
 * capabilities like elicitation.
 *
 * `getServerRef()` reads the active per-request store first
 * (`runWithRequestContext({ server })`, entered by the hosted wrapper around
 * each tool call) and falls back to the module-scoped ref only when no store
 * is active:
 * - Stdio mode: set in index.ts at startup via setServerRef(server.server)
 * - Hosted mode: the per-request store carries this session's server. Workers
 *   may still call setServerRef(this.server.server) in init(), but it is only
 *   the fallback and is never read inside a hosted tool call.
 *
 * A module-scoped ref is NOT safe per session in hosted mode: a Cloudflare
 * isolate can host several Durable Objects of the same class and they share
 * module scope, so the last session to call setServerRef() would win for all
 * of them. Hosted code must not keep per-session values (tokens, clients,
 * servers, token keys) in module scope; use the per-request store and its
 * accessors.
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
import { getActiveRequestContext } from "../request-context/async-request-context.js";

let _server: Server | null = null;

/**
 * Store the MCP Server instance for use by tools.
 * Call once during server initialization.
 *
 * Module-level fallback for stdio, CLI and tests; a `server` in the active
 * per-request store always wins. Hosted code must not rely on it — module
 * scope is shared by every session in a Cloudflare isolate.
 *
 * @param server - The underlying Server instance (McpServer.server)
 */
export function setServerRef(server: Server): void {
  _server = server;
}

/**
 * Get the MCP Server instance: the active per-request store's `server` when
 * there is one, else the module ref from setServerRef().
 * Throws if neither is set.
 *
 * @returns The Server instance
 * @throws Error if no store server is active and setServerRef() has not been called
 */
export function getServerRef(): Server {
  const sessionServer = getActiveRequestContext()?.server;
  if (sessionServer) {
    return sessionServer;
  }
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
