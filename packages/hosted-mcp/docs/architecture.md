# Architecture

## Overview

The hosted MCP server runs as a Cloudflare Worker that acts as both an **OAuth Authorization Server** (to MCP clients) and an **OAuth Client** (to Umbraco via OpenIdDict).

This "Third-Party Authorization Flow" is mandated by the MCP Authorization spec to ensure that Umbraco tokens are never exposed to MCP clients.

## Auth Flow

```
MCP Client                    Worker                         Umbraco
    │                           │                               │
    │── 1. Connect /mcp ───────>│                               │
    │<── 2. 401 + discovery ────│                               │
    │                           │                               │
    │── 3. GET /.well-known ───>│                               │
    │<── OAuth metadata ────────│                               │
    │                           │                               │
    │── 4. GET /authorize ─────>│                               │
    │                           │── 5. Show consent screen      │
    │<── Consent HTML ──────────│                               │
    │                           │                               │
    │── 6. POST /authorize ────>│  (user approves)              │
    │                           │── 7. Redirect to Umbraco ────>│
    │                           │                               │
    │                           │   8. User logs in             │
    │                           │                               │
    │                           │<── 9. Callback with code ─────│
    │                           │── 10. Exchange code ──────────>│
    │                           │<── 11. Umbraco tokens ────────│
    │                           │                               │
    │                           │── 12. Store tokens in KV      │
    │                           │── 13. Issue Worker token      │
    │<── Auth code ─────────────│                               │
    │                           │                               │
    │── 14. POST /token ───────>│                               │
    │<── Worker access token ───│                               │
    │                           │                               │
    │── 15. /mcp + Bearer ─────>│                               │
    │                           │── 16. Look up Umbraco token   │
    │                           │── 17. API call ───────────────>│
    │                           │<── 18. Response ──────────────│
    │<── Tool result ───────────│                               │
```

## Key Security Properties

1. **Token isolation**: Umbraco tokens are stored encrypted in KV and never exposed to MCP clients. The Worker issues its own tokens.

2. **Per-client consent**: Before redirecting to Umbraco, the user sees a consent screen identifying the requesting MCP client. This prevents Confused Deputy attacks.

3. **Single-use state**: OAuth state parameters are stored in KV with 10-minute TTL and deleted after use, preventing replay attacks.

4. **Per-request McpServer**: Each MCP request creates a fresh McpServer instance to prevent response data leakage between clients (MCP SDK 1.26.0+ requirement).

## Component Architecture

```
┌─────────────────────────────────────────────────┐
│                  Worker Entry                     │
│  ┌──────────────────────────────────────────┐   │
│  │           OAuthProvider                    │   │
│  │  - /.well-known/oauth-authorization-server │   │
│  │  - /authorize                              │   │
│  │  - /token                                  │   │
│  │  - /register (dynamic client registration) │   │
│  └──────────┬───────────────────────────────┘   │
│             │                                     │
│  ┌──────────▼───────────┐  ┌──────────────────┐ │
│  │    McpAgent (DO)      │  │  Default Handler  │ │
│  │  - Per-request server │  │  - /authorize     │ │
│  │  - Tool execution     │  │  - /callback      │ │
│  └──────────┬───────────┘  │  - Landing page   │ │
│             │               └──────────────────┘ │
│             │                                     │
│  ┌──────────▼───────────┐                        │
│  │   Fetch Client        │                        │
│  │  - Bearer token       │                        │
│  │  - Token refresh      │                        │
│  └──────────┬───────────┘                        │
└─────────────┼───────────────────────────────────┘
              │
              ▼
      Umbraco Management API
```

## Stdio vs Hosted: What Changes

| Aspect | Stdio (Local) | Hosted (Workers) |
|--------|--------------|------------------|
| Transport | stdin/stdout | Streamable HTTP |
| Authentication | Client credentials (API user) | Authorization Code (backoffice user) |
| HTTP client | Axios | Native fetch |
| Tool definitions | Same | Same |
| Tool filtering | Same | Same |
| Decorators | Same | Same |
| MCP chaining | Supported | Not supported |

## Per-Request Server Creation

The MCP SDK 1.26.0+ requires per-request McpServer creation for hosted deployments to prevent response data leakage between clients:

```typescript
// Each request gets its own server + client
const server = await createPerRequestServer(options, env, authProps);
// authProps.umbracoTokenKey -> look up user's stored Umbraco token
// configureApiClient() -> scoped to this request
```
