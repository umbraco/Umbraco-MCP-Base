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
  /**
   * Name of an extra header sent on every server-side request this Worker
   * makes to Umbraco (Management API calls, OAuth token exchange/refresh,
   * and the Cloud reachability check), so operators behind an IP allow-list
   * firewall can mark MCP traffic and let it through. Defaults to
   * `X-Umbraco-Mcp` when `UMBRACO_MCP_HEADER_VALUE` is set and this is unset.
   */
  UMBRACO_MCP_HEADER_NAME?: string;
  /**
   * Value for the firewall-allowlist header. Treat as sensitive — set via
   * `wrangler secret put UMBRACO_MCP_HEADER_VALUE`, alongside
   * `UMBRACO_OAUTH_CLIENT_SECRET`. Unset = feature off (no header sent).
   */
  UMBRACO_MCP_HEADER_VALUE?: string;

  // Umbraco OAuth client (registered as a public client in Umbraco's OpenIdDict)
  /** OAuth client ID registered in Umbraco */
  UMBRACO_OAUTH_CLIENT_ID: string;
  /** OAuth client secret (optional, only needed for confidential clients) */
  UMBRACO_OAUTH_CLIENT_SECRET?: string;

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
  /**
   * Overrides the operator-configured `expectedUmbracoMajor` (normally the
   * generated `UMBRACO_TARGET_MAJOR`) for the version-mismatch check — set
   * only when deliberately targeting a different Umbraco major. Mirrors the
   * stdio entry point's `UMBRACO_EXPECTED_MAJOR` / `--umbraco-expected-major`.
   */
  UMBRACO_EXPECTED_MAJOR?: string;

  // Multi-site (optional, alternative to per-env vars)
  /** JSON-encoded array of SiteConfig objects for multi-site deployments */
  UMBRACO_SITES?: string;

  // Consent tool selection (optional)
  /** Set to "true" to enable tool selection on the consent screen */
  ENABLE_CONSENT_TOOL_SELECTION?: string;

  // Umbraco Cloud (optional, consumed by `umbracoCloudSiteRouting`'s default `enabled`)
  /**
   * Set to "true" to enable URL-based cloud routing (`/at/{alias}/`) when
   * the worker uses `umbracoCloudSiteRouting`.
   *
   * The Cloud preset reads this at request time via its default `enabled`
   * predicate. When absent or not `"true"`, the library treats the Worker
   * as single-tenant: `/at/*` requests 401 from `OAuthProvider`'s token
   * check, `/authorize` ignores any `/at/{alias}` resource parameter, and
   * `umbracoCloudSiteRouting.resolveSite` returns null. Lets infra
   * (`wrangler.toml [vars]`) flip the mode at deploy time without consumer
   * source edits.
   *
   * Custom (non-Cloud) `SiteRoutingConfig` consumers don't read this var
   * — they pass their own `enabled?: (env) => boolean` predicate (or omit
   * it for always-on routing).
   */
  UMBRACO_CLOUD_ROUTING_ENABLED?: string;
  /** Cloud region used for `{alias}.{region}.umbraco.io` URL composition (default "euwest01"). */
  UMBRACO_CLOUD_REGION?: string;

  // Diagnostic (optional)
  /** Set to "true" to enable the /info diagnostic endpoint (dev-only) */
  ENABLE_INFO_ENDPOINT?: string;
  /**
   * Set to "true" to emit `[mcp-auth]` diagnostic logs covering token
   * store / refresh-request / refresh-result / 401 / retry paths. Off by
   * default — flip via `wrangler secret put LOG_AUTH` when debugging auth
   * regressions, then tail with `wrangler tail | grep mcp-auth`.
   */
  LOG_AUTH?: string;
}
