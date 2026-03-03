/**
 * OAuth helper utilities for E2E tests.
 *
 * Handles dynamic client registration, PKCE generation,
 * and token exchange against the Worker's OAuth endpoints.
 */

import crypto from "node:crypto";

/**
 * Register a dynamic OAuth client with the Worker.
 */
export async function registerClient(
  workerUrl: string,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret?: string }> {
  const response = await fetch(`${workerUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "E2E Test Client",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Client registration failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

/**
 * Generate PKCE code_verifier and code_challenge pair.
 */
export function generatePKCE(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  // Generate a random 32-byte code_verifier (base64url encoded)
  const codeVerifier = crypto.randomBytes(32).toString("base64url");

  // SHA-256 hash of the verifier, base64url encoded
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return { codeVerifier, codeChallenge };
}

/**
 * Build the authorization URL with PKCE parameters.
 */
export function buildAuthorizeUrl(
  workerUrl: string,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state?: string;
  },
): string {
  const url = new URL("/authorize", workerUrl);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state ?? "e2e-test-state");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeCodeForToken(
  workerUrl: string,
  params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  },
): Promise<{ accessToken: string; tokenType: string; expiresIn?: number }> {
  const response = await fetch(`${workerUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
  };
}
