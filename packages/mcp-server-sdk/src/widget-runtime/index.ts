/**
 * Widget runtime — re-exports the in-iframe `App` class and helpers from
 * `@modelcontextprotocol/ext-apps` so consumer widgets can import a single
 * SDK-pinned version instead of depending on the upstream package directly.
 *
 * Consumers should keep `@modelcontextprotocol/ext-apps` as a peerDep
 * matching the SDK's range; this module hides the package name behind a
 * stable subpath.
 *
 * @example
 * ```ts
 * // widgets/my-widget/main.ts
 * import { App, applyDocumentTheme } from "@umbraco-cms/mcp-server-sdk/widget-runtime";
 *
 * const app = new App({ name: "my-widget", version: "1" }, {});
 * applyDocumentTheme();
 * await app.connect();
 * ```
 */

export * from "@modelcontextprotocol/ext-apps";
