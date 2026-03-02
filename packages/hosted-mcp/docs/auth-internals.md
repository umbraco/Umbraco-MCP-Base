# Auth Internals

Low-level details of the OAuth handler implementation: KV state schema, token lifecycle, consent choice extraction, and backoffice endpoint resolution.

For the high-level auth flow, see [Architecture](./architecture.md). For security properties, see [Security](./security.md).

## KV State Schema

All state is stored in the `OAUTH_KV` namespace. Keys use prefixes to distinguish state types.

### `oauth_state:{key}` — Authorization state

Stored when the user approves the consent form. Consumed (read + deleted) when Umbraco redirects back to `/callback`.

| Field | Type | Description |
|-------|------|-------------|
| `authRequest` | `OAuthAuthRequest` | The original MCP client's authorization request |
| `codeVerifier` | `string` | PKCE code verifier for the Umbraco token exchange |
| `consentChoices` | `ConsentChoices?` | User's selections from the consent form |
| `siteClientId` | `string` | Effective OAuth client ID (site-specific or global) |
| `siteClientSecret` | `string?` | Effective OAuth client secret |
| `siteBaseUrl` | `string` | Effective Umbraco base URL |
| `siteServerUrl` | `string?` | Effective server-side URL override |

- **TTL**: 10 minutes (`expirationTtl: 600`)
- **Lifecycle**: Single-use. Deleted immediately on read by `consumeOAuthState()`.
- **Key generation**: `generateSecureRandom()` — 32 bytes of `crypto.getRandomValues`, hex-encoded.

### `oauth_state:consent:{key}` — Consent screen CSRF state

Stored when the consent screen is rendered (GET `/authorize`). Currently stores the requesting client ID for validation.

| Field | Type | Description |
|-------|------|-------------|
| `clientId` | `string` | The MCP client's OAuth client ID |

- **TTL**: 10 minutes
- **Lifecycle**: Created on consent screen render, not currently consumed (future: validate on POST).

### `umbraco_token:{key}` — Stored Umbraco tokens

Stored after a successful authorization code exchange. Retrieved per-request by `createFetchClientFromKV()`.

| Field | Type | Description |
|-------|------|-------------|
| `access_token` | `string` | Umbraco Management API bearer token |
| `token_type` | `string` | Token type (typically "Bearer") |
| `expires_in` | `number?` | Token lifetime in seconds |
| `refresh_token` | `string?` | Refresh token for token renewal |
| `scope` | `string?` | Granted scopes |

- **TTL**: `expires_in + 300` seconds (5-minute buffer for refresh). Falls back to `3600 + 300` if `expires_in` is not set.
- **Lifecycle**: Created once after code exchange. Read on every MCP request. Updated in-place when refreshed. Expires automatically via KV TTL.

## Consent Choice Extraction

The consent form submits choices as standard form fields. `parseConsentChoices()` maps them to a `ConsentChoices` object:

| Form field | Value | Maps to |
|------------|-------|---------|
| `selectedModes[]` | Multi-value (one per checked mode) | `ConsentChoices.selectedModes` |
| `readOnly` | `"true"` (checkbox) | `ConsentChoices.readOnly` |
| `siteId` | Site identifier string | `ConsentChoices.siteId` |

If no fields have meaningful values, returns `undefined` (no consent choices recorded).

Consent choices flow through KV state: stored alongside the PKCE verifier in `oauth_state:{key}`, then extracted in the callback handler and embedded in `AuthProps.consentChoices`.

## Token Lifecycle

### Storage

After a successful authorization code exchange, `storeUmbracoToken()` writes the full `TokenResponse` to `umbraco_token:{key}` with a TTL.

### Retrieval

On each MCP request, `createFetchClientFromKV()` calls `getStoredUmbracoToken()` to retrieve the token. If the token is not found (expired or missing), the server returns an error requiring re-authentication.

### Refresh

When an API call returns 401, the fetch client calls `refreshUmbracoToken()` which:

1. Sends a `refresh_token` grant to Umbraco's token endpoint
2. If successful, stores the new tokens in KV (same key, updated TTL)
3. Returns the new access token to the fetch client
4. The fetch client retries the original request with the new token

If refresh fails (e.g., refresh token expired), the function returns `null`. The fetch client does not retry, and the 401 propagates — the user must re-authenticate.

### Expiry

Tokens expire via KV's built-in TTL mechanism. The 300-second buffer ensures the token remains in KV long enough for a refresh attempt even if `expires_in` is exact.

## Backoffice Endpoint Resolution

Umbraco's backoffice uses OpenIdDict but does **not** expose a separate OIDC discovery document for backoffice endpoints. The generic `/.well-known/openid-configuration` returns member/delivery API endpoints, not backoffice ones.

`getBackofficeEndpoints()` constructs URLs from well-known paths:

| Endpoint | Path | Used for |
|----------|------|----------|
| `authorization_endpoint` | `/umbraco/management/api/v1/security/back-office/authorize` | Browser redirect (user login) |
| `token_endpoint` | `/umbraco/management/api/v1/security/back-office/token` | Server-side code exchange + token refresh |

### Dual base URLs

The function accepts two base URLs:

- **`baseUrl`** (`UMBRACO_BASE_URL`) — Used for `authorization_endpoint` (browser-facing). Must be reachable by the user's browser.
- **`serverBaseUrl`** (`UMBRACO_SERVER_URL`, optional) — Used for `token_endpoint` (server-side). Falls back to `baseUrl` if not set.

**Why?** In local development, the Worker runtime (workerd) cannot reach HTTPS endpoints with self-signed certificates. Setting `UMBRACO_SERVER_URL` to an HTTP proxy allows the server-side token exchange to succeed while the browser redirect still uses the real HTTPS URL.

## Multi-Site Credential Flow

In multi-site deployments, each site has its own Umbraco instance with separate OAuth credentials. Site credentials travel through KV state between the authorize and callback handlers.

### Flow

1. **Consent form** — User selects a site (radio buttons). Site ID submitted as `siteId` form field.
2. **Authorize handler** — `resolveSite()` looks up the `SiteConfig` by ID from the operator's `sites` list. Extracts `baseUrl`, `serverUrl`, `oauthClientId`, `oauthClientSecret`.
3. **KV state** — Site credentials stored alongside PKCE verifier in `oauth_state:{key}`. This is necessary because the callback handler runs in a separate request and needs the site's credentials for token exchange.
4. **Umbraco redirect** — Uses the site's `baseUrl` for `authorization_endpoint`. Callback URL includes the site ID: `/callback/{siteId}`.
5. **Callback handler** — Reads site credentials from KV state. Uses them for token exchange instead of global env vars.
6. **AuthProps** — `siteId` is stored in `AuthProps.consentChoices.siteId`. Used by `createPerRequestServer()` to route API calls to the correct Umbraco instance.

### Why store credentials in KV state?

The authorize and callback handlers are separate HTTP requests. The authorize handler knows which site the user selected, but the callback handler only receives the `state` parameter from Umbraco. Storing site credentials in KV state (keyed by the state parameter) bridges this gap without requiring the callback handler to re-resolve the site from the URL path.
