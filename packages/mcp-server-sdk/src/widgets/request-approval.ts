/**
 * `requestApproval` — yes/no confirmation via MCP elicitation.
 *
 * Sibling to {@link confirmAction} (which uses a `confirm: boolean` schema
 * field, rendered by some hosts as an extra checkbox). `requestApproval`
 * sends an empty-schema elicitation so the host renders a clean
 * Accept / Decline dialog with no inner controls — for tools where Accept
 * already means "go ahead, I'm sure" and the checkbox is friction.
 *
 * Capability-aware along the same lines as `confirmAction`:
 * - Clients with `elicitation.form` → `server.elicitInput({ message, empty schema })`.
 * - Clients with base `elicitation` only → raw `elicitation/create` request.
 * - Clients with no elicitation capability → throws unless `allowAutoAccept`.
 *
 * Honours `process.env.UMBRACO_AUTO_CONFIRM === "true"` as a global short-
 * circuit (returns `true` immediately) — useful for batch/audit campaigns and
 * non-interactive environments.
 *
 * Pair with `hostSupportsMcpApps()` from the same module to route GUI hosts
 * to a widget instead of this elicitation path.
 */

import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitationUnsupportedError } from "../helpers/elicitation.js";
import { getServerRef } from "../helpers/server-ref.js";
import { getSupportedElicitationKind } from "./capability.js";

export { ElicitationUnsupportedError };

export interface RequestApprovalOptions {
  /**
   * When the connected client advertises no elicitation capability at all,
   * return `true` instead of throwing {@link ElicitationUnsupportedError}.
   *
   * Use only for non-destructive flows where skipping the prompt is safer
   * than failing the tool.
   *
   * @default false
   */
  allowAutoAccept?: boolean;
}

interface HandlerExtra {
  requestId?: string | number;
  [key: string]: unknown;
}

const AUTO_CONFIRM_ENV = "UMBRACO_AUTO_CONFIRM";

function autoConfirmOverride(): boolean {
  // Guarded so this works in environments without `process` (Workers).
  if (typeof process === "undefined") return false;
  return process.env?.[AUTO_CONFIRM_ENV] === "true";
}

/**
 * Ask the user to approve an action. Returns `true` only on Accept.
 *
 * @param extra - The handler's `extra` parameter (provides `requestId`).
 * @param message - The prompt shown to the user.
 * @param options - Optional behaviour tweaks.
 * @returns `true` on Accept, `false` on Decline / Cancel.
 * @throws {ElicitationUnsupportedError} when the client advertises no elicitation capability and `allowAutoAccept` is not set.
 */
export async function requestApproval(
  extra: HandlerExtra | undefined,
  message: string,
  options?: RequestApprovalOptions,
): Promise<boolean> {
  if (autoConfirmOverride()) return true;

  const server = getServerRef();
  const requestOptions = { relatedRequestId: extra?.requestId };
  const requestedSchema = {
    type: "object" as const,
    properties: {} as Record<string, never>,
  };
  const kind = getSupportedElicitationKind(server);

  // Test mocks built from `{ elicitInput: jest.fn() }` lack
  // `getClientCapabilities` — treat that as the form path so existing
  // tests don't need per-test capability setup.
  if (kind === "unknown" || kind === "form") {
    const result = await server.elicitInput(
      { message, requestedSchema },
      requestOptions,
    );
    return result.action === "accept";
  }

  if (kind === "base") {
    const result = await (server as unknown as {
      request: (
        req: { method: string; params: unknown },
        schema: typeof ElicitResultSchema,
        opts?: typeof requestOptions,
      ) => Promise<{ action: string }>;
    }).request(
      { method: "elicitation/create", params: { message, requestedSchema } },
      ElicitResultSchema,
      requestOptions,
    );
    return result.action === "accept";
  }

  // kind === "none"
  if (options?.allowAutoAccept) return true;
  throw new ElicitationUnsupportedError(
    "Client does not support elicitation. Use a host with elicitation support, or pass `allowAutoAccept: true`.",
  );
}
