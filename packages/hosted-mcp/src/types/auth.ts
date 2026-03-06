/**
 * Auth Types
 *
 * Pure type definitions used across auth, server, and HTTP layers.
 * Zero runtime dependencies — import these from any layer without
 * pulling in auth implementation code.
 */

import type { SiteConfig } from "./multi-site.js";
import type { ConsentToolConfig, ConsentScreenOptions } from "../auth/consent.js";

/**
 * User info from Umbraco's userinfo endpoint or token claims.
 */
export interface UmbracoUserInfo {
  sub: string;
  name?: string;
  email?: string;
}

/**
 * User's consent choices from the consent screen form.
 * These narrow the admin/operator configuration.
 */
export interface ConsentChoices {
  /** Selected tool modes (subset of available modes) */
  selectedModes?: string[];
  /** Selected collections within the checked modes */
  selectedCollections?: string[];
  /** Selected operation slices (subset of available slices) */
  selectedSlices?: string[];
  /** Whether the user opted for read-only mode */
  readOnly?: boolean;
  /** The site ID for multi-site deployments */
  siteId?: string;
}

/**
 * Props returned to the OAuthProvider after successful authorization.
 * These become available as `props` on authenticated MCP requests.
 */
export interface AuthProps extends Record<string, unknown> {
  /** The stored Umbraco access token (encrypted in KV, key reference) */
  umbracoTokenKey: string;
  /** Umbraco user subject identifier */
  userId: string;
  /** Umbraco user display name */
  userName?: string;
  /** Umbraco user email */
  userEmail?: string;
  /** User's consent choices (modes, read-only, site) */
  consentChoices?: ConsentChoices;
}

/**
 * Options for creating an Umbraco auth handler.
 */
export interface UmbracoAuthHandlerOptions {
  /** Scopes to request from Umbraco (defaults to openid offline_access) */
  scopes?: string[];
  /** Tool selection config for the consent screen */
  consentToolConfig?: ConsentToolConfig;
  /** Server name displayed on the consent screen */
  serverName?: string;
  /** Custom CSS for the consent screen */
  customCss?: string;
  /** Override the entire consent screen rendering */
  renderConsent?: (options: ConsentScreenOptions) => string;
  /** Available sites for multi-site deployments (shown as a picker on consent screen) */
  sites?: SiteConfig[];
  /** Show a "Log in as different user" button on the consent screen (uses RP-Initiated Logout) */
  showReauthButton?: boolean;
}
