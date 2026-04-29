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
 * - Multi-site support
 * - Type definitions
 *
 * @packageDocumentation
 */

// ============================================================================
// Worker Entry Helpers
// ============================================================================

export {
  createDefaultHandler,
  createWorkerExport,
  getServerOptions,
  buildConsentToolConfig,
  type HostedMcpServerOptions,
  type ChainedServerConsentConfig,
  type AuthProps,
} from "./server/worker-entry.js";

// ============================================================================
// Server Factory
// ============================================================================

export {
  createPerRequestServer,
  mergeConsentChoices,
  resolveRequestSite,
  type CreateServerOptions,
  type InstructionsResolver,
  type SiteResolver,
} from "./server/create-server.js";

export {
  registerChainedTools,
  type RegisterChainedToolsOptions,
} from "./server/register-chained-tools.js";

// ============================================================================
// Auth
// ============================================================================

export {
  createAuthorizeHandler,
  createCallbackHandler,
  createLogoutCallbackHandler,
} from "./auth/umbraco-handler.js";

export {
  getStoredUmbracoToken,
  refreshUmbracoToken,
} from "./auth/token-storage.js";

export {
  type UmbracoUserInfo,
  type UmbracoAuthHandlerOptions,
  type ConsentChoices,
} from "./types/auth.js";

export {
  renderConsentScreen,
  consentResponse,
  type ConsentScreenOptions,
  type ConsentToolConfig,
  type ConsentModeOption,
} from "./auth/consent.js";

// ============================================================================
// HTTP Client
// ============================================================================

export {
  createUmbracoFetchClient,
  createFetchClientFromKV,
  CAPTURE_RAW_HTTP_RESPONSE,
  type UmbracoFetchClient,
  type UmbracoFetchClientConfig,
  type FetchClientOptions,
} from "./http/umbraco-fetch-client.js";

// ============================================================================
// Config
// ============================================================================

export {
  loadWorkerConfig,
  loadSiteConfig,
} from "./config/worker-config.js";

// ============================================================================
// Types
// ============================================================================

export {
  type HostedMcpEnv,
  type OAuthAuthRequest,
  type OAuthProviderHelpers,
} from "./types/env.js";

export {
  type SiteConfig,
  type MultiSiteConfig,
} from "./types/multi-site.js";
