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

import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
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
 * Thrown when the connected client advertises no `elicitation` capability at all.
 *
 * Callers can catch this to fall back to a non-interactive code path
 * (e.g. require an explicit `confirm: true` argument on the tool call).
 */
export class ElicitationUnsupportedError extends Error {
  constructor(message = "Client does not support elicitation.") {
    super(message);
    this.name = "ElicitationUnsupportedError";
  }
}

/**
 * Ask the user to confirm an action via MCP elicitation.
 *
 * Sends an elicitation request with a boolean confirm checkbox and waits
 * for the user's response. Returns true if the user accepted and checked
 * the confirm box, false otherwise (declined, cancelled, or unchecked).
 *
 * Capability-aware: clients that advertise `elicitation.form` (e.g. Claude
 * Code) get the form-mode path through `server.elicitInput()`. Clients that
 * advertise the base `elicitation` capability without `form` (e.g. ChatGPT,
 * Claude.ai web at the time of writing) fall back to a bare
 * `elicitation/create` request — schema-driven UI works on any client with
 * the base capability and predates the `form`/`url` sub-capabilities.
 * Clients that advertise no elicitation capability at all throw
 * {@link ElicitationUnsupportedError}.
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
 * @throws {ElicitationUnsupportedError} when the client advertises no elicitation capability
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
  const requestOptions = { relatedRequestId: extra?.requestId };
  const requestedSchema = {
    type: "object" as const,
    properties: {
      confirm: {
        type: "boolean" as const,
        title,
        description: message,
        default: defaultValue,
      },
    },
  };

  // `getClientCapabilities` is undefined on test mocks built from
  // `{ elicitInput: jest.fn() }`. Treat that as the legacy form path so
  // existing tests keep working without per-test capability setup.
  const getCaps = (server as { getClientCapabilities?: () => unknown })
    .getClientCapabilities;
  if (typeof getCaps !== "function") {
    const result = await server.elicitInput(
      { message, requestedSchema },
      requestOptions,
    );
    return result.action === "accept" && !!(result.content as any)?.confirm;
  }

  const caps = getCaps.call(server) as
    | { elicitation?: { form?: unknown } }
    | null
    | undefined;

  // Form-mode path: client explicitly advertises `elicitation.form`.
  if (caps?.elicitation?.form) {
    const result = await server.elicitInput(
      { message, requestedSchema },
      requestOptions,
    );
    return result.action === "accept" && !!(result.content as any)?.confirm;
  }

  // Basic elicitation fallback: client advertises `elicitation` but not
  // `elicitation.form`. Predates the form/url sub-capabilities — schema-
  // driven UI works on any client with the base capability. Bypasses
  // `elicitInput()`'s mode-based capability check and JSON Schema validator.
  if (caps?.elicitation) {
    const result = await (server as unknown as {
      request: (
        req: { method: string; params: unknown },
        schema: typeof ElicitResultSchema,
        opts?: typeof requestOptions,
      ) => Promise<{ action: string; content?: { confirm?: boolean } }>;
    }).request(
      {
        method: "elicitation/create",
        params: { message, requestedSchema },
      },
      ElicitResultSchema,
      requestOptions,
    );
    return result.action === "accept" && !!result.content?.confirm;
  }

  throw new ElicitationUnsupportedError();
}
