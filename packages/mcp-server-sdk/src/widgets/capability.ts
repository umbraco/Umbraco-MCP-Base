/**
 * Capability detection for cross-host elicitation and MCP Apps routing.
 *
 * Empirical findings drive the heuristics here — host capability declarations
 * differ enough between platforms that a single "supports elicitation" check
 * is insufficient. This module exposes the few discriminators that matter for
 * routing decisions in the widgets module.
 */

import { getServerRef } from "../helpers/server-ref.js";

/**
 * Subset of the MCP client capability surface this module reads. Other fields
 * exist on real responses; we widen as we learn.
 */
export interface ClientElicitationCapabilities {
  elicitation?: {
    form?: unknown;
    url?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CapabilityCarrier {
  getClientCapabilities?: () => ClientElicitationCapabilities | null | undefined;
}

/**
 * Read the connected client's advertised capabilities. Returns `undefined` on
 * test mocks (e.g. servers built from `{ elicitInput: jest.fn() }`) so callers
 * can decide whether to fall back to a permissive default.
 */
export function getClientElicitationCapabilities(
  server: unknown = getServerRef(),
): ClientElicitationCapabilities | undefined {
  const carrier = server as CapabilityCarrier;
  if (typeof carrier.getClientCapabilities !== "function") return undefined;
  const caps = carrier.getClientCapabilities.call(carrier);
  return caps ?? undefined;
}

/**
 * Whether the client likely renders MCP App widgets (HTML inline in chat).
 *
 * Empirically, terminal-style hosts (Claude Code, MCP Inspector) advertise
 * `elicitation.form: true` and don't render HTML, whereas web/desktop GUI
 * hosts (Claude.ai web, Claude Desktop, ChatGPT web/desktop) advertise either
 * empty capabilities or proprietary keys but never `elicitation.form`. This
 * heuristic matches the May 2026 capability landscape; revisit as host
 * declarations evolve.
 *
 * Returns `true` when capabilities are absent (e.g. test mocks) — the widget
 * path is the conservative default for unknown hosts. Use {@link
 * getClientElicitationCapabilities} directly when you need a richer signal.
 */
export function hostSupportsMcpApps(server: unknown = getServerRef()): boolean {
  const caps = getClientElicitationCapabilities(server);
  if (!caps) return true;
  return !caps.elicitation?.form;
}

/**
 * Whether the client advertises any form of MCP elicitation.
 *
 * `elicitInput()` (the high-level SDK helper) requires `elicitation.form` and
 * throws otherwise. The lower-level `elicitation/create` request method works
 * on any client with the base `elicitation` capability — this helper exposes
 * which path is available so callers can route accordingly.
 */
export function getSupportedElicitationKind(
  server: unknown = getServerRef(),
): "form" | "base" | "none" | "unknown" {
  const caps = getClientElicitationCapabilities(server);
  if (caps === undefined) return "unknown";
  if (caps.elicitation?.form) return "form";
  if (caps.elicitation) return "base";
  return "none";
}
