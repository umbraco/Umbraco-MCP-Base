/**
 * Telemetry Attribute Names
 *
 * One place where span attribute keys are spelled, so the SDK, each host
 * adapter and the tests can't drift apart. Mirrors the way Umbraco.AI exposes
 * its tag names as `AITelemetry.Tags` constants rather than scattering string
 * literals.
 *
 * Naming follows the OpenTelemetry MCP / GenAI semantic conventions where they
 * exist (`mcp.*`, `gen_ai.*`) and an `umbraco.mcp.*` namespace for everything
 * they don't cover — the same split Umbraco.AI uses when it enriches standard
 * `gen_ai.*` spans with `umbraco.ai.*` tags.
 *
 * Note on the `mcp.*` keys: those attributes were deprecated in OTel's main
 * semantic-conventions registry and moved to `semantic-conventions-genai`,
 * where the method values are still Development-stability. They are used here
 * deliberately — a moving spec is still better than inventing our own spelling
 * for concepts it already names — but treat them as the part of this file most
 * likely to need revisiting, and don't "correct" them back to a local
 * namespace.
 */

/**
 * Span attribute keys emitted for MCP tool calls.
 *
 * Which layer supplies which key:
 * - **Tool-scoped** keys (`GEN_AI_TOOL_NAME` … `DRY_RUN`) are set by
 *   `withTelemetry`, which knows the tool but not the server or the request.
 * - **Server/request-scoped** keys (`SERVER_NAME` … `TENANT`) are set by the
 *   host's `TelemetryAdapter`, which is constructed per request and does know
 *   them. The SDK names them here so hosts agree on the spelling; it does not
 *   set them.
 */
export const TelemetryAttributes = {
  /** JSON-RPC method being served. Always `tools/call` for tool spans. */
  MCP_METHOD_NAME: "mcp.method.name",
  /** MCP session identifier, when the transport supplies one. */
  MCP_SESSION_ID: "mcp.session.id",
  /** Tool being invoked, e.g. `get-document-by-id`. */
  GEN_AI_TOOL_NAME: "gen_ai.tool.name",

  /** Owning tool collection, e.g. `document`. Absent unless registered — see `tool-collection-registry`. */
  COLLECTION: "umbraco.mcp.collection",
  /** Comma-joined slice names, e.g. `read,list`. Absent when the tool declares no slices. */
  SLICES: "umbraco.mcp.slices",
  /** How the call ended — see `ToolOutcome`. */
  OUTCOME: "umbraco.mcp.outcome",
  /** Mirrors `annotations.readOnlyHint`. */
  READ_ONLY: "umbraco.mcp.read_only",
  /** Mirrors `annotations.destructiveHint`. */
  DESTRUCTIVE: "umbraco.mcp.destructive",
  /** Whether dry-run mode intercepted this call. */
  DRY_RUN: "umbraco.mcp.dry_run",

  /** Adapter-supplied: MCP server name, e.g. `umbraco-cms-developer-mcp-17`. */
  SERVER_NAME: "umbraco.mcp.server.name",
  /** Adapter-supplied: MCP server version. */
  SERVER_VERSION: "umbraco.mcp.server.version",
  /** Adapter-supplied: Umbraco major the tools target. */
  UMBRACO_MAJOR: "umbraco.mcp.umbraco_major",
  /** Adapter-supplied: calling MCP client name from `initialize`, e.g. `claude-code`. */
  CLIENT_NAME: "umbraco.mcp.client.name",
  /** Adapter-supplied: calling MCP client version. */
  CLIENT_VERSION: "umbraco.mcp.client.version",
  /**
   * Adapter-supplied: opaque tenant key. Must be a keyed hash, never a
   * plaintext Umbraco Cloud project alias — the alias identifies a customer.
   */
  TENANT: "umbraco.mcp.tenant",
} as const;

/** The only `mcp.method.name` value this module emits. Also the span-name prefix. */
export const TOOLS_CALL_METHOD = "tools/call";

/**
 * How a tool call ended.
 *
 * Deliberately mirrors the error taxonomy `withErrorHandling` already applies,
 * so a span's outcome and the error the caller received describe the same
 * event:
 *
 * | Outcome            | Cause |
 * | ------------------ | ----- |
 * | `success`          | Handler returned a result without `isError` |
 * | `error_result`     | Handler returned `isError: true` rather than throwing (e.g. a pre-execution block) |
 * | `validation_error` | `ToolValidationError` — business-rule rejection |
 * | `api_error`        | `UmbracoApiError`, or an error carrying `response.data` — the API answered, unhappily |
 * | `handler_error`    | Any other `Error` — network failure or a bug in the tool |
 * | `unknown_error`    | A non-`Error` value was thrown |
 *
 * Kept to a small closed set on purpose: this is the highest-value dimension
 * for span-derived metrics, and metric cardinality is a cost.
 */
export type ToolOutcome =
  | "success"
  | "error_result"
  | "validation_error"
  | "api_error"
  | "handler_error"
  | "unknown_error";
