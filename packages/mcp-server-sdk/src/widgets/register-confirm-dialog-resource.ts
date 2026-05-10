/**
 * Register the SDK's built-in confirm-dialog HTML resource on an MCP server.
 *
 * Call once during server init, alongside `setServerRef(server.server)`.
 * The resource URI is exported as `CONFIRM_DIALOG_URI` and is the default
 * `widgetResourceUri` used by `createConfirmedToolDefinition`.
 *
 * The resource is shipped as a single-file HTML blob bundled at SDK build
 * time — it carries its own `App` runtime, so the host renders it without
 * needing further fetches.
 */

import {
  CONFIRM_DIALOG_HTML,
  CONFIRM_DIALOG_URI,
} from "./built-in/confirm-dialog/dist-html.generated.js";

const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

interface MinimalMcpServer {
  registerResource(
    name: string,
    uriOrTemplate: string,
    config: { [key: string]: unknown },
    callback: (uri: URL) => Promise<{
      contents: Array<{
        uri: string;
        mimeType: string;
        text: string;
        _meta?: Record<string, unknown>;
      }>;
    }>,
  ): unknown;
}

export interface RegisterConfirmDialogResourceOptions {
  /**
   * Override the resource name shown in `resources/list`.
   *
   * @default `"Umbraco MCP confirm dialog"`
   */
  name?: string;
  /**
   * Override the rendered display title and description used by hosts that
   * surface resource listings.
   */
  description?: string;
}

export function registerConfirmDialogResource(
  server: MinimalMcpServer,
  options?: RegisterConfirmDialogResourceOptions,
): void {
  server.registerResource(
    options?.name ?? "Umbraco MCP confirm dialog",
    CONFIRM_DIALOG_URI,
    {
      description:
        options?.description ??
        "Built-in confirmation widget rendered when a tool requires explicit user approval.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          preferredFrameSize: { width: 480, height: 220 },
        },
      },
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: CONFIRM_DIALOG_HTML,
          _meta: {
            ui: {
              preferredFrameSize: { width: 480, height: 220 },
            },
          },
        },
      ],
    }),
  );
}

export { CONFIRM_DIALOG_HTML, CONFIRM_DIALOG_URI };
