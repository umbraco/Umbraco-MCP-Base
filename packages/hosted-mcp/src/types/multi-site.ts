/**
 * Multi-Site Configuration Types
 *
 * One hosted MCP Worker can serve multiple Umbraco instances via
 * separate endpoints (e.g., /mcp/prod, /mcp/staging).
 */

/**
 * Configuration for a single Umbraco site.
 */
export interface SiteConfig {
  /** Unique site identifier used in URL paths (e.g., "prod", "staging") */
  id: string;
  /** Human-readable site name */
  displayName: string;
  /** Base URL of the Umbraco instance */
  baseUrl: string;
  /** Optional server-side URL override (for local dev with HTTP proxy) */
  serverUrl?: string;
  /** OAuth client ID registered in this Umbraco instance */
  oauthClientId: string;
  /** OAuth client secret (optional, only for confidential clients) */
  oauthClientSecret?: string;
  /** Per-site tool mode overrides (comma-separated) */
  toolModes?: string;
  /** Per-site include slices override (comma-separated) */
  includeSlices?: string;
  /** Per-site exclude slices override (comma-separated) */
  excludeSlices?: string;
  /** Per-site read-only override ("true" to enable) */
  readOnly?: string;
}

/**
 * Multi-site deployment configuration.
 */
export interface MultiSiteConfig {
  /** Available sites */
  sites: SiteConfig[];
  /** Default site ID (used when no site is specified) */
  defaultSiteId?: string;
}
