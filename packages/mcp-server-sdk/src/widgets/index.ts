/**
 * Confirmation surfaces for MCP tools.
 *
 * `requestApproval` is the only call site needed:
 * - **Terminal hosts** (Claude Code, MCP Inspector, anything that
 *   advertises `elicitation`/`elicitation.form`) → prompt via MCP
 *   elicitation; Accept/Decline propagates to the caller.
 * - **GUI hosts** (Claude.ai web, Claude Desktop, ChatGPT) → auto-accept
 *   because the host already renders a native per-tool permission UI
 *   that gates the call before it ever reaches the server. That UI *is*
 *   the consent surface.
 *
 * Cross-host MCP App widget consent was explored (PR #110/#111 + the
 * spike on staging) and rejected: ChatGPT strips `structuredContent`
 * from widget notifications, Claude.ai doesn't reliably surface
 * `updateModelContext` to the model, and the LLM has the same protocol
 * access as the widget so secrets/tokens aren't securable. The
 * host-native dialog turned out to be the right consent surface anyway.
 */

export {
  hostSupportsMcpApps,
  getSupportedElicitationKind,
  getClientElicitationCapabilities,
  type ClientElicitationCapabilities,
} from "./capability.js";

export {
  requestApproval,
  ElicitationUnsupportedError,
  type RequestApprovalOptions,
} from "./request-approval.js";
