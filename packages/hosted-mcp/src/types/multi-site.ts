/**
 * Multi-Site Configuration Types
 *
 * One hosted MCP Worker can serve multiple Umbraco instances via
 * separate endpoints (e.g., /mcp/prod, /mcp/staging).
 */

import type { HostedMcpEnv } from "./env.js";

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

/**
 * Resolves a SiteConfig from a site identifier extracted from the URL.
 *
 * Error semantics:
 * - Return a SiteConfig → site is valid; flow continues.
 * - Return null → site does not exist; the router responds 404.
 * - Throw → upstream/validation error; the router responds 502 and logs.
 */
export type SiteRoutingResolver = (
  siteId: string,
  env: HostedMcpEnv
) => SiteConfig | null | Promise<SiteConfig | null>;

/**
 * URL-based site routing configuration.
 *
 * The MCP endpoint URL encodes the site identity (e.g. `/at/{alias}/`),
 * so MCP clients can connect to a specific Umbraco instance without picking
 * one on the consent screen.
 *
 * Mutually exclusive with `multiSite` (which uses a static list + consent picker).
 */
export interface SiteRoutingConfig {
  /**
   * Path prefix pattern containing exactly one parameter, e.g. `/at/:siteId`.
   * The MCP endpoint becomes `{pathPrefix}/`.
   */
  pathPrefix: string;
  /**
   * Resolve a SiteConfig from the extracted site identifier. May be async
   * (DNS lookup, KV, external API). Consumers SHOULD cache — this is called
   * once per authorize step and once per MCP request.
   *
   * The returned `oauthClientSecret` may be omitted for PKCE / public clients.
   */
  resolveSite: SiteRoutingResolver;
  /**
   * Optional renderer for the 404 page when `resolveSite` returns null.
   * Defaults to a JSON error response. Override to render HTML for browser
   * users (composes with the html-error-pages plan).
   */
  renderNotFound?: (
    siteId: string,
    request: Request
  ) => Response | Promise<Response>;
  /**
   * Optional runtime gate. Returns `true` to activate site routing for a
   * given request, `false` to behave as a single-tenant deployment for it.
   *
   * Defaults to always-on. The Cloud preset (`umbracoCloudSiteRouting`)
   * defaults this to `(env) => env.UMBRACO_CLOUD_ROUTING_ENABLED === "true"`
   * so infra (`wrangler.toml [vars]`) can flip the mode at deploy time
   * without consumer source edits. Custom non-Cloud `siteRouting` configs
   * may pass their own predicate, e.g. driven by a different env var.
   *
   * On Cloudflare Workers `env` is only available per-request, which is why
   * this lives in the routing config rather than at module scope.
   */
  enabled?: (env: HostedMcpEnv) => boolean;
}
