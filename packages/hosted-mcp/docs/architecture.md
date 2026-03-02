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
    │<── Consent HTML ──────────│   (with tool selection if     │
    │                           │    enableConsentToolSelection) │
    │                           │                               │
    │── 6. POST /authorize ────>│  (user approves + selects     │
    │                           │   modes, read-only)           │
    │                           │── 7. Redirect to Umbraco ────>│
    │                           │   (consent choices stored     │
    │                           │    in KV state)               │
    │                           │                               │
    │                           │   8. User logs in             │
    │                           │                               │
    │                           │<── 9. Callback with code ─────│
    │                           │── 10. Exchange code ──────────>│
    │                           │<── 11. Umbraco tokens ────────│
    │                           │                               │
    │                           │── 12. Store tokens in KV      │
    │                           │── 13. Issue Worker token      │
    │                           │   (with consentChoices in     │
    │                           │    AuthProps)                  │
    │<── Auth code ─────────────│                               │
    │                           │                               │
    │── 14. POST /token ───────>│                               │
    │<── Worker access token ───│                               │
    │                           │                               │
    │── 15. /mcp + Bearer ─────>│                               │
    │                           │── 16. Look up Umbraco token   │
    │                           │── 17. Merge env config with   │
    │                           │       consent choices         │
    │                           │── 18. API call ───────────────>│
    │                           │<── 19. Response ──────────────│
    │<── Tool result ───────────│                               │
```

See [Auth Internals](./auth-internals.md) for KV state schema and handler-level details.

## Key Security Properties

1. **Token isolation**: Umbraco tokens are stored encrypted in KV and never exposed to MCP clients. The Worker issues its own tokens. See [Token Isolation](./token-isolation.md) for a detailed walkthrough with sequence diagrams.

2. **Per-client consent**: Before redirecting to Umbraco, the user sees a consent screen identifying the requesting MCP client. This prevents Confused Deputy attacks.

3. **Single-use state**: OAuth state parameters are stored in KV with 10-minute TTL and deleted after use, preventing replay attacks.

4. **Per-request McpServer**: Each MCP request creates a fresh McpServer instance to prevent response data leakage between clients (MCP SDK 1.26.0+ requirement).

5. **Consent choices narrow only**: User consent choices (selected modes, read-only) can only narrow the admin configuration, never expand it.

## Component Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Worker Entry                         │
│  ┌──────────────────────────────────────────────┐   │
│  │           OAuthProvider                        │   │
│  │  - /.well-known/oauth-authorization-server     │   │
│  │  - /authorize                                  │   │
│  │  - /token                                      │   │
│  │  - /register (dynamic client registration)     │   │
│  └──────────┬───────────────────────────────────┘   │
│             │                                         │
│  ┌──────────▼───────────┐  ┌────────────────────┐   │
│  │    McpAgent (DO)      │  │  Default Handler    │   │
│  │  - Per-request server │  │  - /authorize       │   │
│  │  - Tool execution     │  │  - /callback        │   │
│  │  - Consent merging    │  │  - Landing page     │   │
│  └──────────┬───────────┘  │  - Multi-site routes │   │
│             │               └────────────────────┘   │
│             │                                         │
│  ┌──────────▼───────────┐                            │
│  │   Fetch Client        │                            │
│  │  - Bearer token       │                            │
│  │  - Token refresh      │                            │
│  └──────────┬───────────┘                            │
└─────────────┼───────────────────────────────────────┘
              │
              ▼
      Umbraco Management API
```

## Three-Tier Configuration

Tool availability is controlled by three tiers, each narrowing the one above:

| Tier | Where | Who | What it controls |
|------|-------|-----|------------------|
| **Admin** | `wrangler.toml` / env vars | DevOps | Maximum boundary: modes, slices, read-only |
| **Operator** | `worker.ts` options | Developer | What's available: collections, modes, consent features, sites |
| **User** | Consent screen | End user | What they get (narrowed within admin + operator bounds) |

### How tiers combine

```
Request arrives with AuthProps.consentChoices
          │
          ▼
┌─────────────────────────┐
│ loadWorkerConfig()      │  Reads UMBRACO_TOOL_MODES, UMBRACO_READONLY, etc.
│ (Admin tier)            │  Result: { toolModes: ["content","media"], excludeSlices: [] }
└─────────┬───────────────┘
          │ [if multi-site]
          ▼
┌─────────────────────────┐
│ loadSiteConfig()        │  Site overrides replace base values where specified
│ (Site tier)             │  e.g. staging: { toolModes: ["content"], readOnly: "true" }
└─────────┬───────────────┘
          │ [if consent choices]
          ▼
┌─────────────────────────┐
│ mergeConsentChoices()   │  Intersection for modes, append for excludeSlices
│ (User tier)             │  User selects [content] → result is [content]
└─────────┬───────────────┘
          │
          ▼
   Effective config for this request
```

Each tier can only **narrow** the one above. Users cannot select modes the admin restricted. Sites cannot expand beyond the admin boundary.

### Admin tier (env vars)

Set in `wrangler.toml` or via `wrangler secret put`. These define the maximum boundary:

```toml
[vars]
UMBRACO_TOOL_MODES = "content,media"
UMBRACO_READONLY = "true"
```

### Operator tier (worker.ts)

The developer defines what collections and modes exist, and enables consent features:

```typescript
const options = {
  collections: [contentCollection, mediaCollection, settingsCollection],
  modeRegistry: allModes,
  enableConsentToolSelection: true,
};
```

### User tier (consent screen)

When `enableConsentToolSelection` is enabled, the consent screen shows mode checkboxes and a read-only toggle. Users select which modes they want. Their choices are stored in `AuthProps.consentChoices` and merged into the config at server creation time.

The merge rule is **intersection**: if admin allows `[content, media]` and the user selects `[content]`, the result is `[content]`. Users cannot select modes the admin has restricted.

## Multi-Site Architecture

A single Worker can serve multiple Umbraco instances. All sites share a single MCP endpoint (`/mcp`) — site selection happens during authorization via the consent form. See [Multi-Site Deployments](./multi-site.md) for setup instructions.

### Why a single endpoint?

MCP OAuth discovery (`.well-known/oauth-authorization-server`) only supports a single `authorization_endpoint`. Clients auto-discover this endpoint, so separate `/authorize/:siteId` routes wouldn't work — the client wouldn't know which siteId to use.

Instead, when multiple sites are configured, the consent screen shows a **site picker** (radio buttons). The user selects which Umbraco instance to authorize against as part of the consent flow.

### Route structure

```
/mcp                 — MCP endpoint (shared by all sites)
/authorize           — Consent screen with site picker
/callback/:siteId    — OAuth callback (siteId matches Umbraco's redirect_uri)
/                    — Landing page showing all available sites
```

### How site credentials flow

1. User selects a site on the consent screen and approves
2. The authorize handler resolves the site's OAuth credentials (baseUrl, clientId, clientSecret)
3. These credentials are stored in KV state alongside the PKCE verifier
4. Umbraco redirect uses `/callback/:siteId` as the redirect_uri
5. The callback handler reads site credentials from KV state for token exchange
6. The `siteId` is stored in `AuthProps.consentChoices.siteId`

### Per-request site resolution

When `createPerRequestServer` runs, it reads `props.consentChoices.siteId` to:
- Use the site's base URL for the fetch client (API calls go to the right Umbraco instance)
- Apply site-specific tool filter overrides via `loadSiteConfig()`

Each site can have its own:
- Umbraco base URL and server URL
- OAuth client credentials
- Tool filter overrides (modes, slices, read-only)

## Stdio vs Hosted: What Changes

| Aspect | Stdio (Local) | Hosted (Workers) |
|--------|--------------|------------------|
| Transport | stdin/stdout | Streamable HTTP |
| Authentication | Client credentials (API user) | Authorization Code (backoffice user) |
| HTTP client | Axios | Native fetch |
| Tool definitions | Same | Same |
| Tool filtering | Same | Same + user consent choices |
| Decorators | Same | Same |
| MCP chaining | Supported | Not supported |
| Multi-site | N/A | Supported |

## Per-Request Server Creation

The MCP SDK 1.26.0+ requires per-request McpServer creation for hosted deployments to prevent response data leakage between clients:

```typescript
// Each request gets its own server + client
const server = await createPerRequestServer(options, env, authProps);
// 1. Resolve site (if multi-site, from props.consentChoices.siteId)
// 2. Look up user's stored Umbraco token (authProps.umbracoTokenKey)
// 3. Create fetch client with site-specific base URL
// 4. Load env config (loadWorkerConfig)
// 5. Apply site filter overrides (loadSiteConfig)
// 6. Merge user consent choices (mergeConsentChoices)
// 7. Register tools with merged filtering
```
