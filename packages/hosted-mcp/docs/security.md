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

For a detailed walkthrough with sequence diagrams, see [Token Isolation](./token-isolation.md).

## Consent Screen

The per-client consent screen prevents **Confused Deputy attacks**:

- Shows the name of the MCP client requesting access
- Shows the Umbraco instance that will be accessed
- Shows the requested scopes
- Shows the registered redirect URI
- User must explicitly approve before any Umbraco redirect
- Protected against CSRF via state parameter

### Enhanced consent with tool selection

When `enableConsentToolSelection` is enabled, the consent screen also shows:

- Checkboxes for each tool mode (e.g., Content Management, Media, Settings)
- A read-only toggle to disable write operations
- Descriptions and collection listings for each mode

User selections are stored securely in KV state alongside the OAuth request and flow through to `AuthProps.consentChoices`. These choices can only **narrow** the admin configuration — users cannot enable modes or slices that the admin has restricted via env vars.

### Multi-site consent

In multi-site deployments, the consent screen identifies which Umbraco site the user is authorizing against. The site ID is stored in KV state and flows through to `AuthProps.consentChoices.siteId`.

### Custom consent rendering

Operators can override the consent screen rendering via `renderConsent`. When using a custom renderer:
- The operator is responsible for HTML escaping
- The form must include the `state` hidden field and `action` submit buttons
- Tool selection fields (`selectedModes[]`, `readOnly`) are optional but enable user-tier filtering

## Consent Choices Security

User consent choices follow a **narrowing-only** model:

| Scenario | Result |
|----------|--------|
| Admin allows `[content, media]`, user selects `[content]` | `[content]` (intersection) |
| Admin allows `[content, media]`, user selects `[content, settings]` | `[content]` (settings filtered out) |
| No admin restriction, user selects `[content]` | `[content]` (user restriction applied) |
| Admin sets read-only, user does not check read-only | Read-only (admin overrides) |
| Admin does not set read-only, user checks read-only | Read-only (user restriction applied) |

This ensures that:
- The admin tier is the **maximum boundary** — no user action can exceed it
- Users can self-limit but never self-escalate
- The operator tier (code) defines what's available; the admin tier (env) defines the boundary

## State Parameter Security

- Generated with `crypto.getRandomValues()` (64 hex chars)
- Stored in KV with 10-minute TTL
- Single-use: deleted immediately after consumption
- Consent choices are stored alongside the OAuth state, not in cookies or URL params
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
- Multi-site base URLs are defined in operator code or env vars, not from user input

## Multi-Site Security

In multi-site deployments:

- Each site has its own OAuth client credentials — a compromise of one site's credentials does not affect others
- Site IDs are validated against the configured site list — unknown site IDs return 404
- Site credentials are stored in KV state during authorize and consumed by the callback handler for token exchange
- Per-site tool filter overrides can further restrict (but not expand) the base admin config
- Site selection is explicit: the user picks a site on the consent screen, preventing confused deputy attacks across sites

## Scope Minimization

- Request only the scopes needed for your tool collections
- Configure scopes via `authOptions.scopes` in `HostedMcpServerOptions`
- Default scopes: `openid`, `offline_access`
