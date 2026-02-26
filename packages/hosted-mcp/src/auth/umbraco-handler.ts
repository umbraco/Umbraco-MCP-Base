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
import { consentResponse } from "./consent.js";

// ============================================================================
// Umbraco Backoffice Endpoint Paths
// ============================================================================

/** Well-known backoffice Management API security paths (Umbraco 14+) */
const BACKOFFICE_PATHS = {
  authorize: "/umbraco/management/api/v1/security/back-office/authorize",
  token: "/umbraco/management/api/v1/security/back-office/token",
} as const;

/**
 * Resolves the Umbraco backoffice OAuth endpoints from the base URL.
 *
 * Unlike the member/delivery API, the backoffice does not expose its own
 * OIDC discovery document. We construct URLs from well-known paths.
 *
 * @param baseUrl - Umbraco base URL (used for browser redirects like authorize)
 * @param serverBaseUrl - Optional override for server-side calls (token exchange).
 *   Useful in local dev when the Worker can't reach Umbraco over HTTPS
 *   (e.g. workerd rejects self-signed certs) and an HTTP proxy is used.
 */
function getBackofficeEndpoints(baseUrl: string, serverBaseUrl?: string) {
  const browserBase = baseUrl.replace(/\/$/, "");
  const serverBase = serverBaseUrl ? serverBaseUrl.replace(/\/$/, "") : browserBase;
  return {
    authorization_endpoint: `${browserBase}${BACKOFFICE_PATHS.authorize}`,
    token_endpoint: `${serverBase}${BACKOFFICE_PATHS.token}`,
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Token response from Umbraco's token endpoint.
 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * User info from Umbraco's userinfo endpoint or token claims.
 */
export interface UmbracoUserInfo {
  sub: string;
  name?: string;
  email?: string;
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
}

/**
 * Options for creating an Umbraco auth handler.
 */
export interface UmbracoAuthHandlerOptions {
  /** Scopes to request from Umbraco (defaults to openid offline_access) */
  scopes?: string[];
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
// KV State Management
// ============================================================================

/**
 * Stores an OAuth state parameter in KV with expiry.
 * State is single-use and short-lived (10 minutes).
 */
async function storeOAuthState(
  kv: KVNamespace,
  stateKey: string,
  data: Record<string, unknown>
): Promise<void> {
  await kv.put(`oauth_state:${stateKey}`, JSON.stringify(data), {
    expirationTtl: 600, // 10 minutes
  });
}

/**
 * Retrieves and deletes an OAuth state parameter from KV (single-use).
 */
async function consumeOAuthState(
  kv: KVNamespace,
  stateKey: string
): Promise<Record<string, unknown> | null> {
  const key = `oauth_state:${stateKey}`;
  const data = await kv.get(key);
  if (!data) return null;

  // Delete immediately (single-use)
  await kv.delete(key);

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// ============================================================================
// Token Storage
// ============================================================================

/**
 * Stores Umbraco tokens in KV.
 * Token is keyed by a unique reference and has a TTL matching the token expiry.
 */
async function storeUmbracoToken(
  kv: KVNamespace,
  tokenKey: string,
  tokens: TokenResponse,
  expirationTtl?: number
): Promise<void> {
  const ttl = expirationTtl ?? tokens.expires_in ?? 3600;
  await kv.put(
    `umbraco_token:${tokenKey}`,
    JSON.stringify(tokens),
    { expirationTtl: ttl + 300 } // Add 5 minutes buffer for refresh
  );
}

/**
 * Retrieves a stored Umbraco token from KV.
 */
export async function getStoredUmbracoToken(
  kv: KVNamespace,
  tokenKey: string
): Promise<TokenResponse | null> {
  const data = await kv.get(`umbraco_token:${tokenKey}`);
  if (!data) return null;

  try {
    return JSON.parse(data) as TokenResponse;
  } catch {
    return null;
  }
}

/**
 * Refreshes an expired Umbraco token using the refresh token.
 * Stores the new tokens in KV and returns the new access token.
 */
export async function refreshUmbracoToken(
  env: HostedMcpEnv,
  tokenKey: string,
  refreshToken: string
): Promise<string | null> {
  const endpoints = getBackofficeEndpoints(env.UMBRACO_BASE_URL, env.UMBRACO_SERVER_URL);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.UMBRACO_OAUTH_CLIENT_ID,
  });

  if (env.UMBRACO_OAUTH_CLIENT_SECRET) {
    params.set("client_secret", env.UMBRACO_OAUTH_CLIENT_SECRET);
  }

  const resp = await fetch(endpoints.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!resp.ok) return null;

  const tokens = (await resp.json()) as TokenResponse;
  await storeUmbracoToken(env.OAUTH_KV, tokenKey, tokens);
  return tokens.access_token;
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

  return async (
    request: Request,
    authRequest: OAuthAuthRequest
  ): Promise<Response> => {
    const url = new URL(request.url);

    // Handle POST (consent form submission)
    if (request.method === "POST") {
      const formData = await request.formData();
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

      // User approved - redirect to Umbraco backoffice login
      const endpoints = getBackofficeEndpoints(env.UMBRACO_BASE_URL, env.UMBRACO_SERVER_URL);
      const { codeVerifier, codeChallenge } = await generatePkce();

      // Generate state for Umbraco redirect
      const umbracoState = generateSecureRandom();

      // Store full OAuthAuthRequest + PKCE verifier for completeAuthorization()
      await storeOAuthState(env.OAUTH_KV, umbracoState, {
        authRequest,
        codeVerifier,
      });

      // Build Umbraco authorization URL
      const callbackUrl = new URL("/callback", url.origin).toString();
      const authUrl = new URL(endpoints.authorization_endpoint);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", env.UMBRACO_OAUTH_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", callbackUrl);
      authUrl.searchParams.set("scope", scopes.join(" "));
      authUrl.searchParams.set("state", umbracoState);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      return Response.redirect(authUrl.toString(), 302);
    }

    // GET - show consent screen
    const consentState = generateSecureRandom();
    await storeOAuthState(env.OAUTH_KV, `consent:${consentState}`, {
      clientId: authRequest.clientId,
    });

    return consentResponse({
      clientName: authRequest.clientId,
      umbracoBaseUrl: env.UMBRACO_BASE_URL,
      scopes: authRequest.scope.length > 0 ? authRequest.scope : scopes,
      redirectUri: authRequest.redirectUri,
      actionUrl: url.toString(),
      state: consentState,
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
    props: AuthProps;
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

    // Exchange authorization code for tokens
    const endpoints = getBackofficeEndpoints(env.UMBRACO_BASE_URL, env.UMBRACO_SERVER_URL);
    const callbackUrl = new URL("/callback", url.origin).toString();

    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: env.UMBRACO_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    });

    // Only include client_secret for confidential clients
    if (env.UMBRACO_OAUTH_CLIENT_SECRET) {
      tokenParams.set("client_secret", env.UMBRACO_OAUTH_CLIENT_SECRET);
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

    // Extract user info from the token response if available,
    // or default to the subject from the access token
    const userInfo: UmbracoUserInfo = { sub: "unknown" };

    return {
      props: {
        umbracoTokenKey: tokenKey,
        userId: userInfo.sub,
        userName: userInfo.name,
        userEmail: userInfo.email,
      },
      authRequest,
    };
  };
}
