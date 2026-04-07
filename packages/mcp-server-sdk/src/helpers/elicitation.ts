/**
 * Elicitation Helpers
 *
 * Reduces boilerplate for the common elicitation confirmation pattern used
 * by write tools (create, edit, delete, publish, etc.).
 *
 * Instead of 15+ lines of elicitInput setup per tool:
 * ```typescript
 * const server = getServerRef();
 * const result = await server.elicitInput({
 *   message: "Publish 'Home'?",
 *   requestedSchema: {
 *     type: "object", properties: { confirm: { type: "boolean", ... } }
 *   }
 * }, { relatedRequestId: extra?.requestId });
 * if (result.action !== "accept" || !result.content?.confirm) { ... }
 * ```
 *
 * Use a one-liner:
 * ```typescript
 * const confirmed = await confirmAction(extra, "Publish 'Home'?");
 * if (!confirmed) return createToolResult({ message: "Cancelled" });
 * ```
 *
 * @example
 * ```typescript
 * import { confirmAction } from "@umbraco-cms/mcp-server-sdk";
 *
 * handler: async ({ id }, extra) => {
 *   const confirmed = await confirmAction(extra, `Delete "${pageName}"?`, {
 *     title: "Confirm delete",
 *     defaultValue: false,  // destructive actions default to unchecked
 *   });
 *   if (!confirmed) return createToolResult({ message: "Delete cancelled" });
 *   // ... proceed with deletion
 * }
 * ```
 */

import { getServerRef } from "./server-ref.js";

/**
 * Options for the confirmAction helper.
 */
export interface ConfirmActionOptions {
  /**
   * Title shown on the confirmation checkbox.
   * @default "Confirm"
   */
  title?: string;

  /**
   * Default value for the checkbox.
   * Use `true` for low-risk actions (create, edit, publish).
   * Use `false` for destructive actions (delete, unpublish, rollback).
   * @default true
   */
  defaultValue?: boolean;
}

/**
 * Request handler extra parameter from MCP SDK tool handlers.
 * Only the fields used by elicitation are required.
 */
interface HandlerExtra {
  requestId?: string | number;
  [key: string]: unknown;
}

/**
 * Ask the user to confirm an action via MCP elicitation.
 *
 * Sends an elicitation request with a boolean confirm checkbox and waits
 * for the user's response. Returns true if the user accepted and checked
 * the confirm box, false otherwise (declined, cancelled, or unchecked).
 *
 * Uses `getServerRef()` internally — ensure `setServerRef()` has been
 * called during server initialization.
 *
 * Passes `relatedRequestId` from the handler's `extra` parameter,
 * required for correct elicitation routing over Streamable HTTP.
 *
 * @param extra - The handler's `extra` parameter (provides requestId)
 * @param message - The confirmation message shown to the user
 * @param options - Optional title and default value
 * @returns true if confirmed, false if cancelled/declined
 *
 * @example
 * ```typescript
 * // Low-risk action (default: checked)
 * const confirmed = await confirmAction(extra, `Publish "${pageName}"?`);
 *
 * // Destructive action (default: unchecked)
 * const confirmed = await confirmAction(extra, `Delete "${pageName}"?`, {
 *   title: "Confirm delete",
 *   defaultValue: false,
 * });
 * ```
 */
export async function confirmAction(
  extra: HandlerExtra | undefined,
  message: string,
  options?: ConfirmActionOptions,
): Promise<boolean> {
  const title = options?.title ?? "Confirm";
  const defaultValue = options?.defaultValue ?? true;

  const server = getServerRef();
  const result = await server.elicitInput(
    {
      message,
      requestedSchema: {
        type: "object" as const,
        properties: {
          confirm: {
            type: "boolean" as const,
            title,
            description: message,
            default: defaultValue,
          },
        },
      },
    },
    { relatedRequestId: extra?.requestId },
  );

  return result.action === "accept" && !!(result.content as any)?.confirm;
}
