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

import type { HostedMcpEnv, OAuthAuthRequest } from "../types/env.js";
import type { SiteConfig, SiteRoutingConfig } from "../types/multi-site.js";
import type { ConsentChoices, UmbracoUserInfo, UmbracoAuthHandlerOptions } from "../types/auth.js";
import { consentResponse, type ConsentScreenOptions, type ConsentToolConfig } from "./consent.js";
import {
  buildPrefixRegex,
  extractSiteIdFromResource,
} from "../site-routing/path-prefix.js";
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
// Crypto Helpers
// ============================================================================

/**
 * Generates a cryptographically secure random string for state/PKCE.
 */
function generateSecureRandom(length: number = 32): string {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
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
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
      console.error(`siteRouting.resolveSite threw for "${siteId}":`, err);
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

    // Handle POST (consent form submission)
    if (request.method === "POST") {
      const formData = await request.formData();

      // Validate CSRF state token (generated on GET, embedded as hidden field)
      const submittedState = formData.get("state")?.toString();
      if (!submittedState) {
        return new Response("Missing consent state", { status: 400 });
      }
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
        // Carry siteId through consentChoices so the per-request server can
        // look up the site again with the same resolveSite callback.
        consentChoices = { ...(consentChoices ?? {}), siteId: result.site.id };
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

      // Store full OAuthAuthRequest + PKCE verifier + consent choices + site credentials
      // (site credentials needed by callback handler for token exchange)
      await storeOAuthState(env.OAUTH_KV, umbracoState, {
        authRequest,
        codeVerifier,
        consentChoices,
        siteClientId,
        siteClientSecret,
        siteBaseUrl,
        siteServerUrl,
      });

      // Build Umbraco authorization URL
      // For multi-site, callback includes siteId so the Worker routes it correctly
      const callbackPath = site ? `/callback/${site.id}` : "/callback";
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
        return Response.redirect(signoutUrl.toString(), 302);
      }

      // Approve: redirect directly to Umbraco authorize
      return Response.redirect(authUrl.toString(), 302);
    }

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

    return consentResponse({
      clientName: authRequest.clientId,
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
    });
  };
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
      throw new Error(
        `Umbraco authorization error: ${error} - ${url.searchParams.get("error_description") ?? ""}`
      );
    }

    if (!code || !state) {
      throw new Error("Missing code or state parameter in callback");
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

    // Use site-specific credentials from state if available (multi-site),
    // falling back to global env credentials (single-site)
    const effectiveClientId = (stateData.siteClientId as string) ?? env.UMBRACO_OAUTH_CLIENT_ID;
    const effectiveClientSecret = (stateData.siteClientSecret as string | undefined) ?? env.UMBRACO_OAUTH_CLIENT_SECRET;
    const effectiveBaseUrl = (stateData.siteBaseUrl as string) ?? env.UMBRACO_BASE_URL;
    const effectiveServerUrl = (stateData.siteServerUrl as string | undefined) ?? env.UMBRACO_SERVER_URL;

    // Exchange authorization code for tokens
    const endpoints = getBackofficeEndpoints(effectiveBaseUrl, effectiveServerUrl);

    // Callback URL must match what was sent to Umbraco during authorize
    const callbackPath = consentChoices?.siteId ? `/callback/${consentChoices.siteId}` : "/callback";
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

    // Generate a unique key for this token set
    const tokenKey = generateSecureRandom();

    // Store Umbraco tokens in KV (encrypted at rest by KV)
    await storeUmbracoToken(env.OAUTH_KV, tokenKey, tokens);

    // Mark this MCP client as having completed auth (for reauth button visibility)
    await markClientAuthed(env.OAUTH_KV, authRequest.clientId);

    // Extract user info from the token response if available,
    // or default to the subject from the access token
    const userInfo: UmbracoUserInfo = { sub: "unknown" };

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
