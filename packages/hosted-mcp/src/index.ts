/**
 * @umbraco-cms/mcp-hosted
 *
 * Hosted MCP server infrastructure for Umbraco on Cloudflare Workers.
 * Enables remote deployment of MCP servers with OAuth-based authentication
 * and Streamable HTTP transport.
 *
 * ## Architecture
 *
 * This package provides building blocks for hosted MCP servers.
 * The actual Worker entry point is defined in the consumer's worker.ts
 * because `agents/mcp` and `@cloudflare/workers-oauth-provider` are
 * Wrangler virtual modules only available at wrangler build time.
 *
 * This package provides:
 * - Auth handlers (Umbraco OAuth flow, consent screen)
 * - Fetch-based API client (replaces Axios for Workers runtime)
 * - Per-request McpServer factory (tool registration, filtering)
 * - Worker config loader (env bindings to SDK config)
 * - Default route handler (callback, landing page)
 * - Type definitions
 *
 * @packageDocumentation
 */

// ============================================================================
// Worker Entry Helpers
// ============================================================================

export {
  createDefaultHandler,
  getServerOptions,
  type HostedMcpServerOptions,
  type AuthProps,
} from "./server/worker-entry.js";

// ============================================================================
// Server Factory
// ============================================================================

export {
  createPerRequestServer,
  type CreateServerOptions,
} from "./server/create-server.js";

// ============================================================================
// Auth
// ============================================================================

export {
  createAuthorizeHandler,
  createCallbackHandler,
  getStoredUmbracoToken,
  refreshUmbracoToken,
  type UmbracoUserInfo,
  type UmbracoAuthHandlerOptions,
} from "./auth/umbraco-handler.js";

export {
  renderConsentScreen,
  consentResponse,
  type ConsentScreenOptions,
} from "./auth/consent.js";

// ============================================================================
// HTTP Client
// ============================================================================

export {
  createUmbracoFetchClient,
  createFetchClientFromKV,
  CAPTURE_RAW_HTTP_RESPONSE,
  type UmbracoFetchClientConfig,
  type FetchClientOptions,
} from "./http/umbraco-fetch-client.js";

// ============================================================================
// Config
// ============================================================================

export {
  loadWorkerConfig,
} from "./config/worker-config.js";

// ============================================================================
// Types
// ============================================================================

export {
  type HostedMcpEnv,
  type OAuthAuthRequest,
  type OAuthProviderHelpers,
} from "./types/env.js";
