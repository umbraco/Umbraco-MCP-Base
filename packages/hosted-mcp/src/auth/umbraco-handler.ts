/**
 * Umbraco OAuth Handler
 *
 * Handles the Umbraco side of the Third-Party Authorization Flow.
 * The Worker is both an OAuth Authorization Server (to MCP clients) and
 * an OAuth Client (to Umbraco via OpenIdDict).
 *
 * Umbraco's backoffice uses OpenIdDict but does NOT expose a separate OIDC
 * discovery document for the backoffice endpoints. The generic
 * /.well-known/openid-configuration returns member/delivery API endpoints.
 * So we construct backoffice endpoint URLs from well-known paths.
 *
 * Flow:
 * 1. MCP client hits /authorize on the Worker
 * 2. Worker shows consent screen (consent.ts)
 * 3. User approves -> Worker redirects to Umbraco's authorization endpoint
 * 4. User logs into Umbraco backoffice
 * 5. Umbraco redirects back to Worker's /callback with auth code
 * 6. Worker exchanges code for Umbraco tokens
 * 7. Worker stores Umbraco tokens encrypted in KV
 * 8. Worker completes the original OAuth flow with the MCP client
 */

import { siteRef } from "../telemetry/request-telemetry.js";
import { normalizeBaseUrl } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv, OAuthAuthRequest } from "../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../types/multi-site.js";
import type { ConsentChoices, UmbracoUserInfo, UmbracoAuthHandlerOptions } from "../types/auth.js";
import { consentResponse, type ConsentScreenOptions, type ConsentToolConfig } from "./consent.js";
import {
  buildPrefixRegex,
  extractSiteIdFromOneResource,
  extractSiteIdFromResource,
} from "../site-routing/path-prefix.js";
import { getClientTenant } from "../tenant-oauth/binding-store.js";
import {
  FlowBindingError,
  clearFlowCookieHeader,
  hasMatchingFlowCookie,
  isCrossSiteSubmission,
  redirectResponse,
  setFlowCookieHeader,
  withSetCookies,
} from "./flow-cookies.js";
import { toHex } from "../crypto/hex.js";
import { toBase64Url } from "../crypto/base64url.js";
import {
  getBackofficeEndpoints,
  storeOAuthState,
  consumeOAuthState,
  storeUmbracoToken,
  storeLogoutRedirect,
  consumeLogoutRedirect,
  markClientAuthed,
  isClientAuthed,
  type TokenResponse,
} from "./token-storage.js";

// ============================================================================
// Confused-deputy helper
// ============================================================================

/**
 * Verify that the client's registered tenant matches the resolved site AND
 * that every entry of `resource` (which may be an array) extracts to the
 * same registered tenant. Returns true when the binding is valid.
 *
 * Used at root /authorize under siteRouting to block:
 *   1. Cross-tenant reuse: client registered for A used to authorise for B.
 *   2. Multi-resource expansion: client registered for A authorising with
 *      `resource=[A, B]` to obtain a token whose audience covers both.
 *   3. Audience over-broadening: an entry like `https://<worker>/at` whose
 *      path doesn't carry an alias would be silently kept by OAuthProvider
 *      and would prefix-match every tenant URL on audience validation.
 *
 * Fails closed on any entry that can't be extracted as a tenant alias —
 * legitimate clients only ever send the canonical `${origin}/at/<alias>`.
 */
function checkAllResourceAliasesMatchClient(
  resource: string | string[] | undefined,
  prefixRegex: RegExp,
  registeredTenant: string | null,
  resolvedSiteId: string
): boolean {
  if (registeredTenant === null) return false;
  if (registeredTenant !== resolvedSiteId) return false;
  const values = !resource ? [] : Array.isArray(resource) ? resource : [resource];
  for (const v of values) {
    const alias = extractSiteIdFromOneResource(v, prefixRegex);
    // null (non-extractable) and any cross-tenant value both fail closed.
    if (alias !== registeredTenant) return false;
  }
  return true;
}

// ============================================================================
// Grant user
// ============================================================================

const CURRENT_USER_PATH = "/umbraco/management/api/v1/user/current";
const CURRENT_USER_TIMEOUT_MS = 5000;

/**
 * The OAuth provider's user id for a grant: a hash of the site's base URL and
 * the Umbraco user's id. Scoped to the site because user ids (e.g. the default
 * administrator's) can repeat across Umbraco installs, hashed so the Umbraco
 * user id isn't embedded in MCP access tokens (`{userId}:{grantId}:{secret}`),
 * and hex so it never contains the `:` the provider forbids.
 */
async function grantUserId(siteBaseUrl: string, umbracoUserId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${normalizeBaseUrl(siteBaseUrl)}\n${umbracoUserId}`)
  );
  return toHex(new Uint8Array(digest)).slice(0, 32);
}

/**
 * Looks up the signed-in Umbraco user with the new access token. If that
 * fails, falls back to an id unique to this sign-in: the grant then never
 * matches (or revokes) anyone else's, at the cost of not replacing the same
 * user's earlier grant for this client.
 */
async function resolveGrantUser(
  accessToken: string,
  siteBaseUrl: string,
  siteServerUrl: string | undefined
): Promise<UmbracoUserInfo> {
  try {
    const serverBase = normalizeBaseUrl(siteServerUrl ?? siteBaseUrl);
    const response = await fetch(`${serverBase}${CURRENT_USER_PATH}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(CURRENT_USER_TIMEOUT_MS),
    });
    if (response.ok) {
      const user = (await response.json()) as { id?: unknown; name?: unknown; email?: unknown };
      if (typeof user.id === "string" && user.id) {
        return {
          sub: await grantUserId(siteBaseUrl, user.id),
          name: typeof user.name === "string" ? user.name : undefined,
          email: typeof user.email === "string" ? user.email : undefined,
        };
      }
    }
    console.warn(`[mcp-hosted] could not identify the Umbraco user after sign-in (status=${response.status})`);
  } catch (error) {
    console.warn(
      `[mcp-hosted] could not identify the Umbraco user after sign-in (error=${
        error instanceof Error ? error.name : "unknown"
      })`
    );
  }
  return { sub: `login-${generateSecureRandom(16)}` };
}

// ============================================================================
// Upstream authorization errors
// ============================================================================

/** Upstream errors passed to the MCP client unchanged; anything else becomes `server_error`. */
const PASSTHROUGH_UPSTREAM_ERRORS = new Set(["access_denied", "temporarily_unavailable"]);

/**
 * Raised by the callback handler when Umbraco ended the sign-in with an
 * error and the flow belongs to this browser. `redirectTo` is the MCP
 * client's redirect URI (validated at /authorize) carrying the OAuth error.
 */
export class UpstreamAuthorizationError extends Error {
  constructor(readonly redirectTo: string) {
    super("Umbraco ended the sign-in with an error");
    this.name = "UpstreamAuthorizationError";
  }
}

/**
 * Builds the MCP client redirect for an upstream error. Only a known error
 * code is passed on, with a fixed description: Umbraco's own description is
 * never forwarded.
 */
function clientErrorRedirect(authRequest: OAuthAuthRequest, upstreamError: string): string {
  const code = PASSTHROUGH_UPSTREAM_ERRORS.has(upstreamError) ? upstreamError : "server_error";
  const redirectUrl = new URL(authRequest.redirectUri);
  redirectUrl.searchParams.set("error", code);
  redirectUrl.searchParams.set(
    "error_description",
    code === "access_denied" ? "The sign-in to Umbraco was not completed" : "The sign-in to Umbraco failed"
  );
  if (authRequest.state) {
    redirectUrl.searchParams.set("state", authRequest.state);
  }
  return redirectUrl.toString();
}

// ============================================================================
// Crypto Helpers
// ============================================================================

/**
 * Generates a cryptographically secure random string for state/PKCE.
 */
function generateSecureRandom(length: number = 32): string {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return toHex(buffer);
}

/**
 * Generates a PKCE code verifier and challenge.
 */
async function generatePkce(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const codeVerifier = generateSecureRandom(32);
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const codeChallenge = toBase64Url(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

// ============================================================================
// Consent Choices Helpers
// ============================================================================

/**
 * Extracts consent choices from a form submission.
 */
function parseConsentChoices(formData: FormData): ConsentChoices | undefined {
  const rawModes = formData.getAll("selectedModes[]").map(String).filter(Boolean);
  const rawCollections = formData.getAll("selectedCollections[]").map(String).filter(Boolean);
  const selectedSlices = formData.getAll("selectedSlices[]").map(String).filter(Boolean);
  const readOnly = formData.get("readOnly") === "true";
  const siteId = formData.get("siteId")?.toString() || undefined;

  // Split prefixed values (e.g., "demo:alerts") into main vs chained
  const selectedModes: string[] = [];
  const chainedModeSelections: Record<string, string[]> = {};

  for (const value of rawModes) {
    const colonIdx = value.indexOf(":");
    if (colonIdx > 0) {
      const prefix = value.substring(0, colonIdx);
      const mode = value.substring(colonIdx + 1);
      if (!chainedModeSelections[prefix]) {
        chainedModeSelections[prefix] = [];
      }
      chainedModeSelections[prefix].push(mode);
    } else {
      selectedModes.push(value);
    }
  }

  const selectedCollections: string[] = [];
  const chainedCollectionSelections: Record<string, string[]> = {};

  for (const value of rawCollections) {
    const colonIdx = value.indexOf(":");
    if (colonIdx > 0) {
      const prefix = value.substring(0, colonIdx);
      const col = value.substring(colonIdx + 1);
      if (!chainedCollectionSelections[prefix]) {
        chainedCollectionSelections[prefix] = [];
      }
      chainedCollectionSelections[prefix].push(col);
    } else {
      selectedCollections.push(value);
    }
  }

  // Process deselected collections (explicitly unchecked by the user).
  // These are submitted as hidden inputs by the consent form JS.
  const rawDeselected = formData.getAll("deselectedCollections[]").map(String).filter(Boolean);
  for (const value of rawDeselected) {
    const colonIdx = value.indexOf(":");
    if (colonIdx > 0) {
      const prefix = value.substring(0, colonIdx);
      // Ensure the chained server entry exists (possibly empty) so the worker
      // knows collection filtering was active for this server.
      if (!chainedCollectionSelections[prefix]) {
        chainedCollectionSelections[prefix] = [];
      }
    }
    // Main server deselected collections are handled by mergeConsentChoices
    // comparing selected collections against mode-expanded collections.
  }

  const hasChainedModes = Object.keys(chainedModeSelections).length > 0;
  const hasChainedCollections = Object.keys(chainedCollectionSelections).length > 0;

  // Only return if there are actual choices
  if (selectedModes.length === 0 && selectedCollections.length === 0 &&
      selectedSlices.length === 0 && !readOnly && !siteId &&
      !hasChainedModes && !hasChainedCollections) {
    return undefined;
  }

  const choices: ConsentChoices = {};
  if (selectedModes.length > 0) {
    choices.selectedModes = selectedModes;
  }
  if (selectedCollections.length > 0) {
    choices.selectedCollections = selectedCollections;
  }
  if (selectedSlices.length > 0) {
    choices.selectedSlices = selectedSlices;
  }
  if (readOnly) {
    choices.readOnly = true;
  }
  if (siteId) {
    choices.siteId = siteId;
  }
  if (hasChainedModes) {
    choices.chainedModeSelections = chainedModeSelections;
  }
  if (hasChainedCollections) {
    choices.chainedCollectionSelections = chainedCollectionSelections;
  }
  return choices;
}

/**
 * Resolves a site config by ID from the available sites list.
 */
function resolveSite(
  siteId: string | undefined,
  sites: SiteConfig[] | undefined
): SiteConfig | undefined {
  if (!siteId || !sites) return undefined;
  return sites.find((s) => s.id === siteId);
}

// ============================================================================
// Authorize Handler
// ============================================================================

/**
 * Creates the authorize handler that initiates the Umbraco OAuth flow.
 *
 * This is called when the MCP client's OAuth flow reaches the Worker's
 * /authorize endpoint. It:
 * 1. Shows a consent screen (if not already consented)
 * 2. On approval, redirects to Umbraco's backoffice authorization endpoint
 *
 * @param env - Cloudflare Worker environment bindings
 * @param options - Handler options
 * @returns Handler function for the authorize endpoint
 */
export function createAuthorizeHandler(
  env: HostedMcpEnv,
  options?: UmbracoAuthHandlerOptions
) {
  const scopes = options?.scopes ?? ["openid", "offline_access"];

  // Pre-compile prefix regex once when site routing is configured.
  const siteRouting = options?.siteRouting;
  const sitePrefixRegex = siteRouting
    ? buildPrefixRegex(siteRouting.pathPrefix)
    : null;

  /**
   * Resolve the site for a given OAuth `resource` parameter using the
   * configured siteRouting. Returns:
   * - `{ ok: true, site }` on success
   * - `{ ok: false, response }` when the request should be rejected (with the
   *   response to return)
   */
  const resolveSiteFromResource = async (
    resource: OAuthAuthRequest["resource"]
  ): Promise<
    | { ok: true; site: SiteConfig }
    | { ok: false; response: Response }
  > => {
    if (!siteRouting || !sitePrefixRegex) {
      throw new Error("resolveSiteFromResource called without siteRouting");
    }
    const siteId = extractSiteIdFromResource(resource, sitePrefixRegex);
    if (!siteId) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            error: "invalid_request",
            error_description:
              "OAuth `resource` parameter is required for URL-based site routing",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    let site: SiteConfig | null;
    try {
      site = await siteRouting.resolveSite(siteId, env);
    } catch (err) {
      console.error(`siteRouting.resolveSite threw for site=${await siteRef(siteId, env)}:`, err);
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            error: "bad_gateway",
            error_description: "Failed to resolve site",
          }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    if (!site) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            error: "invalid_request",
            error_description: `Unknown site: ${siteId}`,
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    return { ok: true, site };
  };

  return async (
    request: Request,
    authRequest: OAuthAuthRequest
  ): Promise<Response> => {
    const url = new URL(request.url);

    // OAuthProvider only validates redirect_uri against the client's
    // registration when both values are present, so require both here.
    if (!authRequest.clientId || !authRequest.redirectUri) {
      return invalidRequest("client_id and redirect_uri are required");
    }

    // PKCE with S256 is mandatory (OAuth 2.1; MCP authorization spec).
    // OAuthProvider accepts requests without PKCE, or with "plain", unless
    // configured otherwise, so enforce it here for every deployment.
    if (!authRequest.codeChallenge || authRequest.codeChallengeMethod !== "S256") {
      return invalidRequest("PKCE with code_challenge_method=S256 is required");
    }

    // Handle POST (consent form submission)
    if (request.method === "POST") {
      // The consent form only ever posts to its own origin.
      if (isCrossSiteSubmission(request, url.origin)) {
        return new Response("Consent must be submitted from the consent screen", { status: 403 });
      }

      const formData = await request.formData();

      // Validate the consent state (generated on GET, embedded as a hidden
      // field) and require that it was issued to this browser.
      const submittedState = formData.get("state")?.toString();
      if (!submittedState) {
        return new Response("Missing consent state", { status: 400 });
      }
      const clearConsentCookie = clearFlowCookieHeader("consent", submittedState);
      if (!hasMatchingFlowCookie(request, "consent", submittedState)) {
        return withSetCookies(
          new Response(
            "This consent screen was not opened in this browser. Start the connection again from your AI client.",
            { status: 403 }
          ),
          [clearConsentCookie]
        );
      }

      const response = await handleConsentSubmission(formData, submittedState);
      return withSetCookies(response, [clearConsentCookie]);
    }

    return renderConsent();

    async function handleConsentSubmission(
      formData: FormData,
      submittedState: string
    ): Promise<Response> {
      const consentStateData = await consumeOAuthState(env.OAUTH_KV, `consent:${submittedState}`);
      if (!consentStateData || consentStateData.clientId !== authRequest.clientId) {
        return new Response("Invalid or expired consent state", { status: 403 });
      }

      const action = formData.get("action");

      if (action === "deny") {
        // User denied - redirect back to MCP client with error
        const redirectUrl = new URL(authRequest.redirectUri);
        redirectUrl.searchParams.set("error", "access_denied");
        redirectUrl.searchParams.set(
          "error_description",
          "User denied the authorization request"
        );
        if (authRequest.state) {
          redirectUrl.searchParams.set("state", authRequest.state);
        }
        return Response.redirect(redirectUrl.toString(), 302);
      }

      // User approved or wants to reauth — extract consent choices from form
      let consentChoices = parseConsentChoices(formData);

      // Resolve site-specific config.
      // - URL-based site routing: read siteId from authRequest.resource
      //   (set by the MCP client per the spec) and call resolveSite.
      // - Static multi-site: read siteId from the consent form.
      // - Single-site: fall back to env vars.
      let site: SiteConfig | undefined;
      if (siteRouting) {
        const result = await resolveSiteFromResource(authRequest.resource);
        if (!result.ok) return result.response;
        site = result.site;
        // Confused-deputy defence (issue #100): when siteRouting is on the
        // client_id MUST be registered for the resolved tenant via the
        // per-tenant DCR flow. Reverse-index lookup blocks an attacker from
        // reusing a client registered at /at/A/register against tenant B
        // via root /authorize?resource=${origin}/at/B.
        //
        // Defence-in-depth: when `resource` is an array, EVERY extractable
        // siteId must equal the registered tenant. Otherwise an attacker
        // could pass `resource=A&resource=B` and have OAuthProvider mint a
        // multi-audience token reaching tenant B.
        if (
          !checkAllResourceAliasesMatchClient(
            authRequest.resource,
            sitePrefixRegex!,
            await getClientTenant(env.OAUTH_KV, authRequest.clientId),
            site.id
          )
        ) {
          return new Response(
            JSON.stringify({
              error: "invalid_client",
              error_description: "Client not registered for this site",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        // Carry siteId through consentChoices so the per-request server can
        // look up the site again with the same resolveSite callback.
        // callbackId (when the site config sets one) rides along separately
        // so the token exchange can reconstruct the identical redirect_uri
        // without disturbing siteId's own round-trip through resolveSite.
        consentChoices = {
          ...(consentChoices ?? {}),
          siteId: result.site.id,
          callbackId: result.site.callbackId,
          region: result.site.region,
        };
      } else {
        site = resolveSite(consentChoices?.siteId, options?.sites);
      }

      const siteBaseUrl = site?.baseUrl ?? env.UMBRACO_BASE_URL;
      const siteServerUrl = site?.serverUrl ?? env.UMBRACO_SERVER_URL;
      const siteClientId = site?.oauthClientId ?? env.UMBRACO_OAUTH_CLIENT_ID;
      const siteClientSecret = site?.oauthClientSecret ?? env.UMBRACO_OAUTH_CLIENT_SECRET;

      // Redirect to Umbraco backoffice login
      const endpoints = getBackofficeEndpoints(siteBaseUrl, siteServerUrl);
      const { codeVerifier, codeChallenge } = await generatePkce();

      // Generate state for Umbraco redirect
      const umbracoState = generateSecureRandom();

      // For multi-site, callback includes siteId so the Worker routes it correctly.
      // callbackId overrides siteId when the site config carries addressing
      // metadata (e.g. a region) that Umbraco's own OAuth client registration
      // doesn't know about — see `SiteConfig.callbackId`.
      const callbackPath = site ? `/callback/${site.callbackId ?? site.id}` : "/callback";

      // Store full OAuthAuthRequest + PKCE verifier + consent choices + site credentials
      // (site credentials needed by callback handler for token exchange). The
      // callback path is stored so /callback can check the code came back on
      // this site's redirect URI.
      await storeOAuthState(env.OAUTH_KV, umbracoState, {
        authRequest,
        codeVerifier,
        consentChoices,
        siteClientId,
        siteClientSecret,
        siteBaseUrl,
        siteServerUrl,
        callbackPath,
      });

      // Build Umbraco authorization URL
      const callbackUrl = new URL(callbackPath, url.origin).toString();
      const authUrl = new URL(endpoints.authorization_endpoint);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", siteClientId);
      authUrl.searchParams.set("redirect_uri", callbackUrl);
      authUrl.searchParams.set("scope", scopes.join(" "));
      authUrl.searchParams.set("state", umbracoState);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      if (action === "reauth") {
        // Reauth: redirect through Umbraco's signout endpoint first to clear
        // the session cookie, then back to the Worker's /logout-callback which
        // redirects to the authorize URL for a fresh login.
        await storeLogoutRedirect(env.OAUTH_KV, umbracoState, authUrl.toString());

        const signoutUrl = new URL(endpoints.signout_endpoint);
        signoutUrl.searchParams.set(
          "post_logout_redirect_uri",
          new URL("/logout-callback", url.origin).toString()
        );
        signoutUrl.searchParams.set("state", umbracoState);
        signoutUrl.searchParams.set("client_id", siteClientId);
        return redirectResponse(signoutUrl.toString(), [
          setFlowCookieHeader("state", umbracoState),
        ]);
      }

      // Approve: redirect directly to Umbraco authorize. The state cookie is
      // set immediately before leaving for Umbraco and checked at /callback.
      return redirectResponse(authUrl.toString(), [setFlowCookieHeader("state", umbracoState)]);
    }

    async function renderConsent(): Promise<Response> {
      // GET - show consent screen
      const consentState = generateSecureRandom();
      await storeOAuthState(env.OAUTH_KV, `consent:${consentState}`, {
        clientId: authRequest.clientId,
      });

      // Resolve the site at consent-render time when URL-based site routing is on.
      // This both validates the resource parameter early and lets us show the
      // resolved site's display name + base URL on the consent screen.
      let routedSite: SiteConfig | undefined;
      if (siteRouting) {
        const result = await resolveSiteFromResource(authRequest.resource);
        if (!result.ok) return result.response;
        routedSite = result.site;

        // Confused-deputy defence (issue #100). Same check as the POST branch
        // — also enforced on consent-screen render so the user never sees a
        // consent prompt for a tenant the client isn't registered against.
        // Defence-in-depth: every extractable resource alias must match.
        if (
          !checkAllResourceAliasesMatchClient(
            authRequest.resource,
            sitePrefixRegex!,
            await getClientTenant(env.OAUTH_KV, authRequest.clientId),
            routedSite.id
          )
        ) {
          return new Response(
            JSON.stringify({
              error: "invalid_client",
              error_description: "Client not registered for this site",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // Build sites list for consent screen.
      // - URL-based routing: single resolved site (renders as a hidden input, no picker).
      // - Static multi-site: the configured list (renders as a radio picker).
      const consentSites = routedSite
        ? [
            {
              id: routedSite.id,
              displayName: routedSite.displayName,
              baseUrl: routedSite.baseUrl,
            },
          ]
        : options?.sites?.map((s) => ({
            id: s.id,
            displayName: s.displayName,
            baseUrl: s.baseUrl,
          }));

      // Show reauth button only when the operator enabled it AND this client
      // has completed at least one auth flow before (KV marker exists)
      let showReauthButton = false;
      if (options?.showReauthButton) {
        showReauthButton = await isClientAuthed(env.OAUTH_KV, authRequest.clientId);
      }

      // The consent cookie binds this consent state to the browser shown the screen.
      return withSetCookies(
        consentResponse({
          clientName: await lookupClientName(env, authRequest.clientId),
          clientId: authRequest.clientId,
          umbracoBaseUrl: routedSite?.baseUrl ?? env.UMBRACO_BASE_URL,
          scopes: authRequest.scope.length > 0 ? authRequest.scope : scopes,
          redirectUri: authRequest.redirectUri,
          actionUrl: url.toString(),
          state: consentState,
          toolConfig: options?.consentToolConfig,
          serverName: options?.serverName,
          customCss: options?.customCss,
          renderConsent: options?.renderConsent,
          sites: consentSites,
          showReauthButton,
        }),
        [setFlowCookieHeader("consent", consentState)]
      );
    }
  };
}

function invalidRequest(description: string): Response {
  return new Response(
    JSON.stringify({ error: "invalid_request", error_description: description }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Returns the client's registered `client_name`, or `undefined` when the
 * client registered without one (or can't be looked up).
 */
async function lookupClientName(
  env: HostedMcpEnv,
  clientId: string
): Promise<string | undefined> {
  if (typeof env.OAUTH_PROVIDER?.lookupClient !== "function") return undefined;
  try {
    const client = (await env.OAUTH_PROVIDER.lookupClient(clientId)) as
      | { clientName?: unknown }
      | null
      | undefined;
    return typeof client?.clientName === "string" && client.clientName.trim()
      ? client.clientName.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Callback Handler
// ============================================================================

/**
 * Creates the callback handler that completes the Umbraco OAuth flow.
 *
 * Called when Umbraco redirects back with an authorization code.
 * Exchanges the code for tokens, stores them, and returns user info.
 *
 * @param env - Cloudflare Worker environment bindings
 * @returns Handler function for the callback endpoint
 */
export function createCallbackHandler(env: HostedMcpEnv) {
  return async (
    request: Request
  ): Promise<{
    props: import("../types/auth.js").AuthProps;
    authRequest: OAuthAuthRequest;
  }> => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      // Umbraco ended the sign-in with an error (e.g. the user cancelled). When
      // the callback comes back to the browser that started the flow, end the
      // flow and tell the MCP client, so it isn't left waiting. Otherwise the
      // client's redirect URI isn't a safe destination, so the caller shows an
      // error page instead.
      if (state && hasMatchingFlowCookie(request, "state", state)) {
        const stateData = await consumeOAuthState(env.OAUTH_KV, state);
        const authRequest = stateData?.authRequest as OAuthAuthRequest | undefined;
        if (authRequest?.redirectUri) {
          throw new UpstreamAuthorizationError(clientErrorRedirect(authRequest, error));
        }
      }
      throw new Error(
        `Umbraco authorization error: ${error} - ${url.searchParams.get("error_description") ?? ""}`
      );
    }

    if (!code || !state) {
      throw new Error("Missing code or state parameter in callback");
    }

    // The state must come back to the browser that approved the consent
    // screen. Checked before consuming state or exchanging the code, so a
    // rejected callback never touches Umbraco tokens.
    if (!hasMatchingFlowCookie(request, "state", state)) {
      throw new FlowBindingError();
    }

    // Consume state (single-use)
    const stateData = await consumeOAuthState(env.OAUTH_KV, state);
    if (!stateData) {
      throw new Error("Invalid or expired OAuth state parameter");
    }

    // Retrieve the full OAuthAuthRequest stored during authorize
    const authRequest = stateData.authRequest as OAuthAuthRequest;
    if (!authRequest?.clientId) {
      throw new Error("Invalid state: missing authRequest");
    }

    const codeVerifier = stateData.codeVerifier as string;
    if (!codeVerifier) {
      throw new Error("Invalid state: missing codeVerifier");
    }

    // Extract consent choices if present
    const consentChoices = stateData.consentChoices as ConsentChoices | undefined;

    // The callback must arrive on the redirect URI this flow sent to Umbraco.
    // Each site has its own callback path, so a code that comes back on
    // another site's path was issued by a different authorization server
    // than the one this state belongs to (OAuth mix-up, RFC 9700 §4.4) and
    // must not be sent to this site's token endpoint.
    // A state stored before the path was recorded (a sign-in in progress
    // during an upgrade) has none and is rejected; the user starts again.
    const callbackPath = stateData.callbackPath;
    if (typeof callbackPath !== "string" || url.pathname !== callbackPath) {
      throw new Error("Callback does not match the site this sign-in was started for");
    }

    // Use site-specific credentials from state if available (multi-site),
    // falling back to global env credentials (single-site)
    const effectiveClientId = (stateData.siteClientId as string) ?? env.UMBRACO_OAUTH_CLIENT_ID;
    const effectiveClientSecret = (stateData.siteClientSecret as string | undefined) ?? env.UMBRACO_OAUTH_CLIENT_SECRET;
    const effectiveBaseUrl = (stateData.siteBaseUrl as string) ?? env.UMBRACO_BASE_URL;
    const effectiveServerUrl = (stateData.siteServerUrl as string | undefined) ?? env.UMBRACO_SERVER_URL;

    // Exchange authorization code for tokens
    const endpoints = getBackofficeEndpoints(effectiveBaseUrl, effectiveServerUrl);

    // Callback URL must match what was sent to Umbraco during authorize.
    const callbackUrl = new URL(callbackPath, url.origin).toString();

    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: effectiveClientId,
      code_verifier: codeVerifier,
    });

    // Only include client_secret for confidential clients
    if (effectiveClientSecret) {
      tokenParams.set("client_secret", effectiveClientSecret);
    }

    const tokenResp = await fetch(endpoints.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    if (!tokenResp.ok) {
      const errorBody = await tokenResp.text();
      throw new Error(
        `Token exchange failed: ${tokenResp.status} ${tokenResp.statusText} - ${errorBody}`
      );
    }

    const tokens = (await tokenResp.json()) as TokenResponse;

    // Identify the Umbraco user the grant belongs to, alongside the KV writes
    // below. The OAuth provider revokes a user's earlier grants for the same
    // client when a new one is issued, so this must be per user — never a
    // shared value.
    const userInfoPromise = resolveGrantUser(
      tokens.access_token,
      effectiveBaseUrl,
      effectiveServerUrl
    );

    // Generate a unique key for this token set
    const tokenKey = generateSecureRandom();

    // Store Umbraco tokens in KV (encrypted, see storeUmbracoToken) along
    // with the per-tenant OAuth context, so refresh can use the correct
    // client_id / base URL even from call sites that don't have the site
    // resolved.
    await storeUmbracoToken(
      env.OAUTH_KV,
      tokenKey,
      tokens,
      {
        oauthClientId: effectiveClientId,
        oauthClientSecret: effectiveClientSecret,
        baseUrl: effectiveBaseUrl,
        serverUrl: effectiveServerUrl,
      },
      env
    );

    // Mark this MCP client as having completed auth (for reauth button visibility)
    await markClientAuthed(env.OAUTH_KV, authRequest.clientId);

    const userInfo = await userInfoPromise;

    return {
      props: {
        umbracoTokenKey: tokenKey,
        userId: userInfo.sub,
        userName: userInfo.name,
        userEmail: userInfo.email,
        consentChoices,
      },
      authRequest,
    };
  };
}

// ============================================================================
// Logout Callback Handler
// ============================================================================

/**
 * Creates the handler for /logout-callback.
 *
 * After Umbraco's signout endpoint clears the session cookie, it redirects
 * here with a `state` query parameter. We look up the stored authorize URL
 * and redirect to it, forcing a fresh login form.
 *
 * @param env - Cloudflare Worker environment bindings
 * @returns Handler function for the logout-callback endpoint
 */
export function createLogoutCallbackHandler(env: HostedMcpEnv) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");

    if (!state) {
      return new Response(
        JSON.stringify({ error: "Missing state parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const authorizeUrl = await consumeLogoutRedirect(env.OAUTH_KV, state);
    if (!authorizeUrl) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired logout state" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return Response.redirect(authorizeUrl, 302);
  };
}
