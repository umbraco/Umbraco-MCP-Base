/**
 * Hosted-Worker Telemetry Attributes
 *
 * Span names and attribute keys for events that only exist in the hosted
 * deployment — server initialisation inside a Durable Object, and the OAuth
 * token refresh. They live here rather than in the SDK's `TelemetryAttributes`
 * because a stdio server has neither: it has no Durable Object lifecycle and
 * authenticates with client credentials, not a refresh token.
 *
 * Same `umbraco.mcp.*` namespace as the SDK's keys, so a query can filter on the
 * prefix and get everything this product emits.
 */

import type { RefreshFailureReason } from "../auth/token-storage.js";

/**
 * Span covering `createPerRequestServer`.
 *
 * Not a parent of `tools/call` spans, despite both happening "inside" the
 * Durable Object: `init()` runs once when the DO starts, while tool calls arrive
 * on later requests. They're siblings in a trace, not nested.
 *
 * Its main job is the question Umbraco-MCP-Base#132 was about — whether a
 * request paid for a cold start or woke a hibernated DO — which duration plus
 * `mode` answers directly.
 */
export const SERVER_INIT_SPAN = "mcp.server.init";

/** Span covering one OAuth refresh-token round-trip against Umbraco. */
export const AUTH_REFRESH_SPAN = "mcp.auth.refresh";

export const HostedTelemetryAttributes = {
  /**
   * `full` when tools were registered, `degraded-auth-expired` when the KV token
   * was gone or its refresh token was definitively rejected by Umbraco.
   */
  INIT_MODE: "umbraco.mcp.init.mode",
  /** Number of tools registered on the server this request will use. */
  INIT_TOOL_COUNT: "umbraco.mcp.init.tool_count",
  /** Whether a site was resolved (multi-site / cloud routing) — the alias itself is never recorded. */
  INIT_SITE_RESOLVED: "umbraco.mcp.init.site_resolved",

  /** `refreshed` when Umbraco issued a new access token, `failed` otherwise. */
  AUTH_OUTCOME: "umbraco.mcp.auth.outcome",
  /**
   * Why a refresh failed, as one of the normalised `AuthRefreshFailureReason`
   * values — never the raw OAuth error string or response body, both of which
   * can carry instance-identifying detail and must not leave the account.
   */
  AUTH_FAILURE_REASON: "umbraco.mcp.auth.failure_reason",
  /** Whether the refresh used a per-site OAuth client rather than the Worker-wide one. */
  AUTH_SITE_CONTEXT: "umbraco.mcp.auth.site_context",
  /** Whether Umbraco returned a new refresh token to store alongside the access token. */
  AUTH_ROTATED_REFRESH_TOKEN: "umbraco.mcp.auth.rotated_refresh_token",

  /**
   * HTTP status from the token endpoint. Standard OTel key, so an APM's HTTP
   * views pick it up without mapping.
   */
  HTTP_STATUS: "http.response.status_code",
} as const;

/** `umbraco.mcp.init.mode` values. */
export type ServerInitMode = "full" | "degraded-auth-expired";

/** `umbraco.mcp.auth.outcome` values. */
export type AuthRefreshOutcome = "refreshed" | "failed";

/**
 * `umbraco.mcp.auth.failure_reason` values — the normalised classification of a
 * failed refresh. Aliases `RefreshFailureReason` from `auth/token-storage.ts`
 * (the type-only import back into that module is erased at compile time, so
 * this isn't a runtime cycle) so the two can't drift apart. Only `expired` is
 * definitive enough to strip a session's toolset.
 */
export type AuthRefreshFailureReason = RefreshFailureReason;
