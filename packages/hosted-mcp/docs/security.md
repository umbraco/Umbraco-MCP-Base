# Security Model

## MCP Authorization Spec Compliance

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Token passthrough forbidden | Yes | Worker issues its own tokens; Umbraco tokens stored in KV |
| Third-Party Authorization Flow | Yes | Worker is both OAuth AS and OAuth Client |
| Per-client consent | Yes | Consent screen shown before Umbraco redirect |
| PKCE required | Yes | S256 challenge for both Worker-to-Umbraco and Client-to-Worker flows |
| Dynamic Client Registration (RFC 7591) | Yes | OAuthProvider supports /register endpoint |
| Per-request McpServer | Yes | createPerRequestServer() called per request |
| Cryptographic session IDs | Yes | crypto.getRandomValues() for all tokens/state |
| Origin header validation | Yes | OAuthProvider validates origin headers |

## Token Isolation

Umbraco tokens are **never exposed** to MCP clients:

1. MCP client authenticates to the Worker and receives a **Worker-issued token**
2. The Worker stores the **Umbraco token** encrypted in Workers KV
3. On each MCP request, the Worker looks up the Umbraco token from KV
4. The Worker uses the Umbraco token to call the Umbraco Management API
5. Only tool results (not tokens) are returned to the MCP client

## Consent Screen

The per-client consent screen prevents **Confused Deputy attacks**:

- Shows the name of the MCP client requesting access
- Shows the Umbraco instance that will be accessed
- Shows the requested scopes
- Shows the registered redirect URI
- User must explicitly approve before any Umbraco redirect
- Protected against CSRF via state parameter

## State Parameter Security

- Generated with `crypto.getRandomValues()` (64 hex chars)
- Stored in KV with 10-minute TTL
- Single-use: deleted immediately after consumption
- Prevents replay and CSRF attacks

## CSRF Protection

- OAuth state parameters validated on all redirects
- Consent form includes hidden state field
- X-Frame-Options: DENY on all HTML responses
- Content-Security-Policy: frame-ancestors 'none'

## Token Refresh

When an Umbraco access token expires:

1. The fetch client detects a 401 response
2. If a refresh token is stored, it exchanges it for a new access token
3. The new tokens are stored in KV
4. The original request is retried with the new token
5. If refresh fails, the user must re-authenticate

## SSRF Mitigations

- `UMBRACO_BASE_URL` is configured as a secret, not from user input
- All API calls go through the configured base URL only
- No user-controlled URL construction in API calls

## Scope Minimization

- Request only the scopes needed for your tool collections
- Configure scopes via `authOptions.scopes` in `createHostedMcpServer()`
- Default scopes: `openid`, `offline_access`
