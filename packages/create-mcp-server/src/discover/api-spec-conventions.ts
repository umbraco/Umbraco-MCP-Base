/**
 * Umbraco API spec URL conventions — single source of truth for the
 * swagger → openapi switch.
 *
 * Umbraco exposes its OpenAPI specs (and the docs UI that lists them) under two
 * different URL conventions, and **Umbraco 18 is the switch point**:
 *
 * | Concern         | Umbraco ≤ 17 (Swashbuckle)                 | Umbraco 18+ (Microsoft.AspNetCore.OpenApi) |
 * | --------------- | ------------------------------------------ | ------------------------------------------ |
 * | Spec document   | `/umbraco/swagger/{name}/swagger.json`     | `/umbraco/openapi/{name}.json`             |
 * | Docs UI         | `/umbraco/swagger/`                        | `/umbraco/openapi/`                        |
 * | OAuth2 redirect | `/umbraco/swagger/oauth2-redirect.html`    | `/umbraco/openapi/oauth2-redirect.html`    |
 * | Spec version    | OpenAPI 3.0                                | OpenAPI 3.1                                |
 *
 * The OAuth client id (`umbraco-swagger`) and the Management API contract
 * (`/umbraco/management/api/v1/...`) are unchanged across the switch.
 *
 * The CLI never asks which Umbraco version it's talking to — it probes the
 * **newer (openapi) convention first** and falls back to the legacy (swagger)
 * one, so a single build works against Umbraco 17 (LTS) and 18+ alike.
 */

/** Identifies which URL convention an Umbraco instance uses for its API specs. */
export type ApiSpecConvention = "openapi" | "swagger";

/**
 * The Umbraco major version at which the spec endpoints were renamed from
 * `swagger` to `openapi` (Swashbuckle → Microsoft.AspNetCore.OpenApi).
 */
export const OPENAPI_SWITCH_MAJOR = 18;

interface Convention {
  readonly id: ApiSpecConvention;
  /** Base path of the docs UI / spec root, e.g. `/umbraco/openapi`. */
  readonly basePath: string;
  /** Build the spec document URL for a known document name (e.g. `management`). */
  specUrl(origin: string, name: string): string;
  /** Candidate URLs for the UI config that embeds the spec list (`index.js`, etc). */
  uiConfigSources(origin: string): string[];
  /** The docs UI landing URL (used for health checks). */
  docsUi(origin: string): string;
  /** The OAuth2 PKCE redirect page registered for the `umbraco-swagger` client. */
  oauthRedirect(origin: string): string;
}

const OPENAPI: Convention = {
  id: "openapi",
  basePath: "/umbraco/openapi",
  specUrl: (origin, name) => `${origin}/umbraco/openapi/${name}.json`,
  uiConfigSources: (origin) => [
    `${origin}/umbraco/openapi/index.js`,
    `${origin}/umbraco/openapi/`,
    `${origin}/umbraco/openapi/index.html`,
  ],
  docsUi: (origin) => `${origin}/umbraco/openapi/`,
  oauthRedirect: (origin) => `${origin}/umbraco/openapi/oauth2-redirect.html`,
};

const SWAGGER: Convention = {
  id: "swagger",
  basePath: "/umbraco/swagger",
  specUrl: (origin, name) => `${origin}/umbraco/swagger/${name}/swagger.json`,
  uiConfigSources: (origin) => [
    `${origin}/umbraco/swagger/index.js`,
    `${origin}/umbraco/swagger/`,
    `${origin}/umbraco/swagger/index.html`,
  ],
  docsUi: (origin) => `${origin}/umbraco/swagger/`,
  oauthRedirect: (origin) => `${origin}/umbraco/swagger/oauth2-redirect.html`,
};

/**
 * Conventions in probe order: newer (openapi) first so modern instances are
 * matched without touching legacy paths, legacy (swagger) as fallback.
 */
export const API_SPEC_CONVENTIONS: readonly Convention[] = [OPENAPI, SWAGGER];

/** Strip any trailing slashes from a base URL so paths concatenate cleanly. */
export function normalizeOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Base path used to resolve bare-relative spec URLs (legacy Swashbuckle UI). */
export const SWAGGER_UI_BASE_PATH = SWAGGER.basePath;

/**
 * Ordered list of UI-config URLs to fetch when discovering specs — both
 * conventions, openapi first.
 */
export function uiConfigSources(baseUrl: string): string[] {
  const origin = normalizeOrigin(baseUrl);
  return API_SPEC_CONVENTIONS.flatMap((c) => c.uiConfigSources(origin));
}

/**
 * Ordered candidate spec URLs for a known document name (e.g. `management`),
 * openapi first. Used by the fallback probe when the UI config can't be parsed.
 */
export function specUrlCandidates(baseUrl: string, name: string): string[] {
  const origin = normalizeOrigin(baseUrl);
  return API_SPEC_CONVENTIONS.map((c) => c.specUrl(origin, name));
}

/** Ordered docs-UI URLs for health checks, openapi first. */
export function docsUiCandidates(baseUrl: string): string[] {
  const origin = normalizeOrigin(baseUrl);
  return API_SPEC_CONVENTIONS.map((c) => c.docsUi(origin));
}

/** Ordered OAuth2 redirect URLs for the PKCE flow, openapi first. */
export function oauthRedirectCandidates(baseUrl: string): string[] {
  const origin = normalizeOrigin(baseUrl);
  return API_SPEC_CONVENTIONS.map((c) => c.oauthRedirect(origin));
}
