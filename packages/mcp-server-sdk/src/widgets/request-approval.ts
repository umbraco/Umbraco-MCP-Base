/**
 * `requestApproval` — yes/no confirmation via MCP elicitation, on hosts
 * that support it.
 *
 * Sibling to {@link confirmAction} (which uses a `confirm: boolean` schema
 * field, rendered by some hosts as an extra checkbox). `requestApproval`
 * sends an empty-schema elicitation so the host renders a clean
 * Accept / Decline dialog with no inner controls — for tools where Accept
 * already means "go ahead, I'm sure" and the checkbox is friction.
 *
 * Capability-aware:
 * - Clients with `elicitation.form` (e.g. Claude Code, MCP Inspector) →
 *   `server.elicitInput({ message, empty schema })` and the boolean result
 *   reflects the user's choice.
 * - Clients with base `elicitation` only → raw `elicitation/create` request.
 * - Clients with **no elicitation capability at all** (Claude.ai web,
 *   Claude Desktop, ChatGPT) → returns `true` (auto-accept). These hosts
 *   already render a native per-tool permission dialog before any tool
 *   call ever reaches the server, so an additional elicitation surface
 *   isn't possible and would be redundant if it were. The host UI *is*
 *   the consent boundary; tools can safely run when reached.
 *
 * Cross-host MCP App widget consent was prototyped and rejected — see
 * the spike summary in this repo's PR history for the empirical
 * justification (ChatGPT strips `structuredContent` from widget
 * notifications; Claude.ai doesn't deliver `updateModelContext` to the
 * model reliably; widgets cannot retrieve original call args via any
 * channel the runtime preserves).
 *
 * Honours `process.env.UMBRACO_AUTO_CONFIRM === "true"` as a global
 * short-circuit (returns `true` immediately) — useful for batch/audit
 * campaigns and non-interactive environments.
 */

import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { ElicitationUnsupportedError } from "../helpers/elicitation.js";
import { getServerRef } from "../helpers/server-ref.js";
import { getSupportedElicitationKind } from "./capability.js";

export { ElicitationUnsupportedError };

export interface RequestApprovalOptions {
  /**
   * Legacy escape hatch. The default behaviour on hosts that advertise no
   * elicitation capability is now to return `true` (host-native consent
   * is the boundary). Setting this to `false` restores the older
   * "throw `ElicitationUnsupportedError`" behaviour for callers that
   * want explicit failure on hosts without elicitation.
   *
   * @default true
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
 * Ask the user to approve an action.
 *
 * @param extra - The handler's `extra` parameter (provides `requestId`).
 * @param message - The prompt shown to the user.
 * @param options - Optional behaviour tweaks.
 * @returns `true` on Accept (or on GUI hosts that don't elicit, where the
 *  host's native permission UI already gates the call); `false` on Decline.
 * @throws {ElicitationUnsupportedError} only when `allowAutoAccept: false`
 *  is explicitly passed AND the client advertises no elicitation.
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

  // kind === "none" — GUI hosts (Claude.ai, Claude Desktop, ChatGPT).
  // The host's native per-tool permission UI is the consent boundary;
  // the tool call only reaches us after the user has already approved.
  // Auto-accept by default; callers can opt back into the old throw
  // behaviour with `allowAutoAccept: false`.
  if (options?.allowAutoAccept === false) {
    throw new ElicitationUnsupportedError(
      "Client does not support elicitation and `allowAutoAccept: false` was set.",
    );
  }
  void message; // implicit-trust path; the host UI showed the args.
  return true;
}
