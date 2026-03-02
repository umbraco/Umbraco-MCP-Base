# Multi-Site Deployments

A single Cloudflare Worker can serve multiple Umbraco instances. This is useful when you have separate environments (production, staging) or multiple tenants sharing one MCP server.

## How It Works

All sites share a single MCP endpoint (`/mcp`). Site selection happens during authorization — the consent screen shows a **site picker** where the user chooses which Umbraco instance to connect to.

The multi-site flow adds two extra steps to the standard OAuth flow (see [Architecture - Auth Flow](./architecture.md#auth-flow) for the full sequence):
1. The consent screen includes a **site picker** (radio buttons) — the user selects which Umbraco instance to authorize against
2. The callback URL includes the site ID (`/callback/:siteId`) so the Worker knows which site's credentials to use for token exchange

### Why a single MCP endpoint?

MCP OAuth discovery (`.well-known/oauth-authorization-server`) returns a single `authorization_endpoint`. Clients auto-discover this endpoint, so separate `/authorize/:siteId` routes wouldn't work — the client wouldn't know which siteId to use.

The site picker in the consent form solves this: one authorize endpoint, user picks the site interactively.

## Setup

### 1. Configure sites in worker.ts

```typescript
const options = {
  name: "my-umbraco-mcp",
  version: "1.0.0",
  collections,
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
  enableConsentToolSelection: true,
  multiSite: {
    sites: [
      {
        id: "prod",
        displayName: "Production",
        baseUrl: "https://prod.example.com",
        oauthClientId: "mcp-prod",
        oauthClientSecret: env.PROD_CLIENT_SECRET,
      },
      {
        id: "staging",
        displayName: "Staging",
        baseUrl: "https://staging.example.com",
        oauthClientId: "mcp-staging",
        oauthClientSecret: env.STAGING_CLIENT_SECRET,
      },
    ],
  },
};
```

Each site needs:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | URL-safe identifier (used in callback path) |
| `displayName` | Yes | Shown on consent screen and landing page |
| `baseUrl` | Yes | Umbraco instance URL (browser redirects) |
| `serverUrl` | No | Override for server-side calls (e.g., HTTP proxy for local dev) |
| `oauthClientId` | Yes | OAuth client ID registered in this Umbraco instance |
| `oauthClientSecret` | No | OAuth client secret (omit for public clients) |
| `toolModes` | No | Comma-separated mode override for this site |
| `includeSlices` | No | Comma-separated slice include override |
| `excludeSlices` | No | Comma-separated slice exclude override |
| `readOnly` | No | `"true"` to force read-only for this site |

### 2. Register OAuth clients in each Umbraco instance

Each Umbraco instance needs the Worker registered as an authorization_code OAuth client. The callback URL **must include the site ID**:

**Production Umbraco** (`McpOAuthComposer.cs`):

```csharp
RedirectUris =
{
    new Uri("https://my-mcp.workers.dev/callback/prod"),
    new Uri("http://localhost:8787/callback/prod"),  // local dev
},
```

**Staging Umbraco** (`McpOAuthComposer.cs`):

```csharp
RedirectUris =
{
    new Uri("https://my-mcp.workers.dev/callback/staging"),
    new Uri("http://localhost:8787/callback/staging"),  // local dev
},
```

See [Umbraco Setup](./umbraco-setup.md) for the full Composer code.

### 3. Set Worker secrets

Each site's OAuth secret should be a Wrangler secret:

```bash
wrangler secret put PROD_CLIENT_SECRET
wrangler secret put STAGING_CLIENT_SECRET
```

Reference them in your `worker.ts` via `env.PROD_CLIENT_SECRET` etc.

### 4. OAuthProvider wiring

No changes needed — `apiRoute` and `authorizeEndpoint` stay the same:

```typescript
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }),
  defaultHandler: createDefaultHandler(options),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
```

## Routes

| Route | Description |
|-------|-------------|
| `/mcp` | MCP endpoint (shared by all sites) |
| `/authorize` | Consent screen with site picker |
| `/callback/:siteId` | OAuth callback (siteId matches Umbraco's registered redirect_uri) |
| `/` | Landing page showing all available sites |

## How Site Credentials Flow

Understanding how the selected site's credentials travel through the OAuth flow:

1. **Consent screen** — User picks a site (radio buttons) and approves
2. **Authorize POST handler** — Resolves the site config from `options.sites`, reads its `baseUrl`, `oauthClientId`, `oauthClientSecret`
3. **KV state** — Site credentials are stored alongside the PKCE verifier and auth request (10-minute TTL, single-use)
4. **Umbraco redirect** — Uses the site's base URL and client ID. Callback URL is `/callback/:siteId`
5. **Callback handler** — Reads site credentials from KV state (not from env) for token exchange
6. **AuthProps** — The `siteId` is stored in `props.consentChoices.siteId`
7. **Per-request server** — Resolves the site config to use the correct base URL for API calls and apply site-specific filter overrides

## Per-Site Tool Filtering

Each site can override tool filtering independently. These overrides are applied on top of the base env config:

```typescript
{
  id: "staging",
  displayName: "Staging",
  baseUrl: "https://staging.example.com",
  oauthClientId: "mcp-staging",
  toolModes: "content",       // Only content tools on staging
  readOnly: "true",           // Read-only on staging
}
```

The filtering tiers stack:

1. **Admin** (env vars) — Maximum boundary
2. **Site** (SiteConfig overrides) — Replaces base values where specified
3. **User** (consent choices) — Further narrows via intersection

A staging site configured as read-only stays read-only even if the user doesn't check the read-only toggle on the consent screen.

## Security

- Each site has its own OAuth client credentials — a compromise of one site's credentials does not affect others
- Site IDs in callback paths are validated against the configured site list — unknown IDs return 404
- Site credentials are stored in KV state (encrypted at rest, 10-minute TTL, single-use) — not in cookies or URL params
- Site selection is explicit on the consent screen, preventing confused deputy attacks across sites
- Per-site tool filter overrides can further restrict (but not expand) the base admin config

## Local Development

For local dev with multiple sites, each Umbraco instance needs `http://localhost:8787/callback/:siteId` registered as a redirect URI. If using self-signed certs, set `serverUrl` per site:

```typescript
{
  id: "local-prod",
  displayName: "Local Production",
  baseUrl: "https://localhost:44391",
  serverUrl: "http://localhost:44380",  // HTTP proxy
  oauthClientId: "mcp-local",
  oauthClientSecret: env.LOCAL_CLIENT_SECRET,
}
```

## Single Site (No Multi-Site)

If you don't configure `multiSite`, the Worker operates in single-site mode:

- No site picker on the consent screen
- Uses `UMBRACO_BASE_URL` and `UMBRACO_OAUTH_CLIENT_ID` from env
- Callback URL is `/callback` (no siteId suffix)
- Landing page shows the single Umbraco instance

This is the default and requires no changes from the basic setup.
