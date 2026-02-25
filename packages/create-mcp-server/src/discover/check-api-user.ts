import { randomBytes, createHash } from "node:crypto";
import pc from "picocolors";

const TOKEN_PATH = "/umbraco/management/api/v1/security/back-office/token";
const LOGIN_PATH = "/umbraco/management/api/v1/security/back-office/login";
const AUTHORIZE_PATH = "/umbraco/management/api/v1/security/back-office/authorize";
const USER_PATH = "/umbraco/management/api/v1/user";

// The pre-registered Swagger OAuth client (available in non-production)
const SWAGGER_CLIENT_ID = "umbraco-swagger";

// Well-known admin user group key from Umbraco core
const ADMIN_GROUP_KEY = "e5e7f6c8-7f9c-4b5b-8d5d-9e1e5a4f7e4d";

const DEFAULT_CLIENT_ID = "umbraco-back-office-mcp";
const DEFAULT_CLIENT_SECRET = "1234567890";
const DEFAULT_ADMIN_EMAIL = "admin@test.com";
const DEFAULT_ADMIN_PASSWORD = "SecurePass1234";

export interface ApiUserCheckResult {
  authenticated: boolean;
  created?: boolean;
  error?: string;
}

/**
 * Check if the API user exists by attempting to authenticate with client credentials.
 * If authentication fails, attempt to create the API user automatically using admin credentials.
 */
export async function checkApiUser(baseUrl: string): Promise<ApiUserCheckResult> {
  // Step 1: Try authenticating with the API user credentials
  const tokenResult = await tryClientCredentials(baseUrl);
  if (tokenResult.authenticated) {
    return { authenticated: true };
  }

  // Step 2: API user doesn't exist — try to create it automatically
  console.log(pc.dim("  API user not found, attempting to create..."));

  const createResult = await tryCreateApiUser(baseUrl);
  if (createResult.created) {
    return { authenticated: true, created: true };
  }

  return { authenticated: false, error: createResult.error };
}

async function tryClientCredentials(baseUrl: string): Promise<{ authenticated: boolean }> {
  try {
    const response = await fetch(`${baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: DEFAULT_CLIENT_ID,
        client_secret: DEFAULT_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    return { authenticated: response.ok };
  } catch {
    return { authenticated: false };
  }
}

async function tryCreateApiUser(baseUrl: string): Promise<{ created: boolean; error?: string }> {
  try {
    // Step 1: Login as admin to get auth cookie
    const loginResponse = await fetch(`${baseUrl}${LOGIN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: DEFAULT_ADMIN_EMAIL,
        password: DEFAULT_ADMIN_PASSWORD,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });

    if (!loginResponse.ok) {
      return { created: false, error: "Could not login as admin — credentials may have changed" };
    }

    const cookies = extractCookies(loginResponse);
    if (!cookies) {
      return { created: false, error: "No auth cookie returned from login" };
    }

    // Step 2: Get a bearer token via OAuth authorization code flow with PKCE
    const bearerToken = await getBearerToken(baseUrl, cookies);
    if (!bearerToken) {
      return { created: false, error: "Could not obtain bearer token from authorization flow" };
    }

    // Step 3: Create a new API-type user (client credentials only work on API users, not regular users)
    const createUserResponse = await fetch(`${baseUrl}${USER_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        email: "mcp-api@localhost",
        userName: "mcp-api@localhost",
        name: "MCP API User",
        kind: "Api",
        userGroupIds: [{ id: ADMIN_GROUP_KEY }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!createUserResponse.ok) {
      const errorBody = await createUserResponse.json().catch(() => null) as { title?: string; detail?: string } | null;
      const detail = errorBody?.detail || errorBody?.title || `HTTP ${createUserResponse.status}`;
      return { created: false, error: `Failed to create API user: ${detail}` };
    }

    // Extract the new user's ID from the Location header (e.g. /api/v1/user/{guid})
    const location = createUserResponse.headers.get("location");
    const userId = location?.split("/").pop();
    if (!userId) {
      return { created: false, error: "Created API user but could not extract user ID from response" };
    }

    // Step 4: Set client credentials on the new API user
    const credentialsResponse = await fetch(
      `${baseUrl}${USER_PATH}/${userId}/client-credentials`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          clientId: DEFAULT_CLIENT_ID,
          clientSecret: DEFAULT_CLIENT_SECRET,
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (credentialsResponse.ok) {
      return { created: true };
    }

    const credError = await credentialsResponse.json().catch(() => null) as { title?: string; detail?: string } | null;
    const credDetail = credError?.detail || credError?.title || `HTTP ${credentialsResponse.status}`;
    return { created: false, error: `API user created but failed to set credentials: ${credDetail}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { created: false, error: message };
  }
}

/**
 * Obtain a bearer token using the OAuth authorization code flow with PKCE.
 * Uses the pre-registered Swagger client (available in development mode).
 *
 * Flow: cookie → authorize (get auth code) → token exchange → bearer token
 */
async function getBearerToken(baseUrl: string, cookies: string): Promise<string | undefined> {
  // Generate PKCE code verifier and challenge
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const redirectUri = `${baseUrl}/umbraco/swagger/oauth2-redirect.html`;

  // Request authorization code — server returns a 302 redirect with ?code=...
  const authorizeUrl = new URL(`${baseUrl}${AUTHORIZE_PATH}`);
  authorizeUrl.searchParams.set("client_id", SWAGGER_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const authorizeResponse = await fetch(authorizeUrl.toString(), {
    headers: { Cookie: cookies },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

  // Extract auth code from the Location header redirect
  const locationHeader = authorizeResponse.headers.get("location");
  if (!locationHeader) {
    return undefined;
  }

  const locationUrl = new URL(locationHeader, baseUrl);
  const authCode = locationUrl.searchParams.get("code");
  if (!authCode) {
    return undefined;
  }

  // Exchange auth code for bearer token
  const tokenResponse = await fetch(`${baseUrl}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: SWAGGER_CLIENT_ID,
      code: authCode,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) {
    return undefined;
  }

  const tokenData = await tokenResponse.json() as { access_token?: string };
  return tokenData.access_token;
}

function extractCookies(response: Response): string | undefined {
  const setCookieHeaders = response.headers.getSetCookie?.();
  if (!setCookieHeaders || setCookieHeaders.length === 0) {
    return undefined;
  }

  return setCookieHeaders
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export function printApiUserWarning(): void {
  console.log();
  console.log(pc.yellow("  Could not create API user automatically."));
  console.log();
  console.log(pc.bold("  Create it manually via the Umbraco backoffice UI:"));
  console.log(pc.dim("    1. Go to Settings > Users in the Umbraco backoffice"));
  console.log(pc.dim("    2. Create an API user with:"));
  console.log(pc.dim(`       Client ID:     ${DEFAULT_CLIENT_ID}`));
  console.log(pc.dim(`       Client Secret: ${DEFAULT_CLIENT_SECRET}`));
  console.log(pc.dim("    3. Grant the user appropriate permissions for the APIs you want to use"));
  console.log();
}
