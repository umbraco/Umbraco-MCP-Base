/**
 * Widgets module — cross-host confirmation surfaces for MCP tools.
 *
 * Two paths, picked at request time based on client capabilities:
 * - **GUI hosts** (Claude.ai, Claude Desktop, ChatGPT web/desktop) render
 *   MCP App widgets inline in chat. Tools return a `_meta.ui.resourceUri`
 *   reference; the iframe handles user interaction and calls the same tool
 *   back with `confirmed: true`.
 * - **Terminal hosts** (Claude Code, MCP Inspector) advertise
 *   `elicitation.form` and don't render HTML. Tools call `requestApproval`
 *   synchronously and proceed on accept.
 *
 * `registerConfirmedTool` (PR 2) wraps both paths in a single helper.
 * This module currently exports the primitives those wrappers compose.
 *
 * @see modelcontextprotocol.io/extensions/apps/overview for the MCP Apps spec.
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
