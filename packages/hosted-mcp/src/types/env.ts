/**
 * Cloudflare Worker Environment Bindings
 *
 * Defines the environment interface for hosted MCP servers running on
 * Cloudflare Workers. These bindings are configured in wrangler.toml
 * and secrets are set via `wrangler secret put`.
 */

// ============================================================================
// OAuth Provider Types
// ============================================================================

/**
 * OAuth authorization request from an MCP client, as parsed by the
 * OAuthProvider's `parseAuthRequest()`.
 *
 * Defined here (rather than importing from `@cloudflare/workers-oauth-provider`)
 * because the provider package is a Wrangler virtual module only available
 * at wrangler build time, not at library compile time.
 */
export interface OAuthAuthRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource?: string | string[];
}

/**
 * Subset of the OAuthProvider helper methods injected into the Worker
 * environment as `env.OAUTH_PROVIDER` by `@cloudflare/workers-oauth-provider`.
 */
export interface OAuthProviderHelpers {
  parseAuthRequest(request: Request): Promise<OAuthAuthRequest>;
  completeAuthorization(options: {
    request: OAuthAuthRequest;
    userId: string;
    metadata: unknown;
    scope: string[];
    props: unknown;
  }): Promise<{ redirectTo: string }>;
  lookupClient(clientId: string): Promise<unknown>;
}

// ============================================================================
// Worker Environment
// ============================================================================

/**
 * Environment bindings for a hosted Umbraco MCP Worker.
 *
 * Required secrets (set via `wrangler secret put`):
 * - UMBRACO_OAUTH_CLIENT_ID
 * - UMBRACO_OAUTH_CLIENT_SECRET
 * - COOKIE_ENCRYPTION_KEY (generate with: openssl rand -hex 32)
 *
 * Required bindings (configured in wrangler.toml):
 * - OAUTH_KV: KV namespace for token storage
 * - MCP_AGENT: Durable Object namespace for stateful MCP sessions
 *
 * Injected by OAuthProvider at runtime:
 * - OAUTH_PROVIDER: Helper methods for OAuth flow management
 */
export interface HostedMcpEnv {
  // Umbraco instance configuration
  /** Base URL of the Umbraco instance (e.g., https://my-umbraco.example.com) */
  UMBRACO_BASE_URL: string;
  /** Optional HTTP base URL for server-side calls (token exchange, API).
   *  Use when workerd can't reach UMBRACO_BASE_URL (e.g. self-signed cert in local dev). */
  UMBRACO_SERVER_URL?: string;

  // Umbraco OAuth client credentials
  // The Worker is registered as an OAuth client in Umbraco's OpenIdDict
  /** OAuth client ID registered in Umbraco */
  UMBRACO_OAUTH_CLIENT_ID: string;
  /** OAuth client secret registered in Umbraco */
  UMBRACO_OAUTH_CLIENT_SECRET: string;

  // Cookie/session encryption
  /** Encryption key for session cookies (hex string, 32 bytes) */
  COOKIE_ENCRYPTION_KEY: string;

  // KV namespaces
  /** KV namespace for encrypted token storage */
  OAUTH_KV: KVNamespace;

  // Durable Objects
  /** Durable Object namespace for stateful MCP sessions */
  MCP_AGENT: DurableObjectNamespace;

  // OAuth Provider (injected by @cloudflare/workers-oauth-provider at runtime)
  /** Helper methods for managing OAuth authorization flows */
  OAUTH_PROVIDER: OAuthProviderHelpers;

  // Tool filtering (optional)
  /** Comma-separated tool mode names */
  UMBRACO_TOOL_MODES?: string;
  /** Comma-separated slice names to include */
  UMBRACO_INCLUDE_SLICES?: string;
  /** Comma-separated slice names to exclude */
  UMBRACO_EXCLUDE_SLICES?: string;
  /** Set to "true" to block write operations */
  UMBRACO_READONLY?: string;
}
