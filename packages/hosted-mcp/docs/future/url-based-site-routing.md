# URL-Based Site Routing

## Problem

The current multi-site approach uses a consent screen site picker — all sites share `/mcp` and the user selects a site during authorization. This works well when a single MCP client needs access to multiple sites, but creates friction for Umbraco Cloud and similar platforms where each project has a known, predictable URL.

In platform scenarios, the MCP client already knows which site it wants to connect to. Requiring the user to pick a site on the consent screen is an unnecessary step. A URL-based approach would let the MCP client URL directly determine the target site, with no picker needed.

## Approach: Path Prefix Routing

Each site gets its own path prefix. The MCP client URL encodes the site identity:

```
https://mcp.example.com/sites/project-abc/mcp   → Umbraco Cloud project "abc"
https://mcp.example.com/sites/project-xyz/mcp   → Umbraco Cloud project "xyz"
```

From the MCP client's perspective, these are just different server URLs. No changes needed on the client side.

### How it works with OAuthProvider

OAuthProvider is configured with a static `apiRoute: "/mcp"`. It won't match `/sites/project-abc/mcp` directly. The solution is a **URL-rewriting layer** that wraps OAuthProvider:

1. Incoming request to `/sites/project-abc/mcp` is rewritten to `/mcp`
2. OAuthProvider handles the rewritten request normally (routes to McpAgent)
3. The site identity flows through the OAuth flow via the **`resource` parameter**

### Full flow

```
MCP Client                     Router              OAuthProvider / Worker          Umbraco
    │                            │                        │                           │
    │── Connect                  │                        │                           │
    │   /sites/abc/mcp ─────────>│── Rewrite to /mcp ───>│                           │
    │<── 401 ────────────────────│<───────────────────────│                           │
    │                            │                        │                           │
    │── GET /.well-known ────────│── Pass through ───────>│                           │
    │<── { authorization_endpoint: "/authorize" } ────────│                           │
    │                            │                        │                           │
    │── GET /authorize           │                        │                           │
    │   resource=/sites/abc/mcp ─│── Pass through ───────>│                           │
    │                            │                        │── Extract "abc" from       │
    │                            │                        │   resource URL             │
    │                            │                        │── resolveSite("abc")       │
    │<── Consent screen (no site picker, site is known) ──│                           │
    │                            │                        │                           │
    │── POST /authorize ─────────│── Pass through ───────>│                           │
    │                            │                        │── Store siteId + creds     │
    │                            │                        │   in KV state              │
    │                            │                        │── Redirect to Umbraco ────>│
    │                            │                        │   callback=/callback/abc   │
    │                            │                        │                           │
    │                            │                        │<── /callback/abc ──────────│
    │                            │                        │── Token exchange ──────────>│
    │                            │                        │   (creds from KV state)    │
    │                            │                        │<── Umbraco tokens ─────────│
    │<── Auth complete ──────────│<───────────────────────│                           │
    │                            │                        │                           │
    │── /sites/abc/mcp           │                        │                           │
    │   + Bearer token ─────────>│── Rewrite to /mcp ───>│                           │
    │                            │                        │── AuthProps.siteId="abc"   │
    │                            │                        │── API call (abc URL) ─────>│
    │<── Tool result ────────────│<───────────────────────│<──────────────────────────│
```

Key points:
- The **router only rewrites the MCP endpoint path** (`/sites/:siteId/mcp` → `/mcp`). All other routes (`/authorize`, `/callback/:siteId`, `/.well-known`, `/token`, `/register`) pass through unchanged.
- The **`resource` parameter** carries the site identity through the OAuth flow. MCP clients set this to their server URL per the MCP spec (e.g., `resource=https://host/sites/abc/mcp`).
- The **authorize handler** extracts the siteId from `authRequest.resource` (available on both GET and POST since OAuthProvider parses it), then calls `resolveSite("abc", env)` which returns a `SiteConfig` containing the Umbraco `baseUrl`, `oauthClientId`, and `oauthClientSecret`. These are used to construct the Umbraco authorization redirect — same mechanism as current multi-site, but the site is determined by URL instead of the consent form picker.
- The **callback and per-request server** work the same as current multi-site — siteId and site credentials are stored in KV state during authorize and flow through into `AuthProps.consentChoices.siteId`.

### Fallback when `resource` is missing

If an MCP client doesn't set the `resource` parameter (non-compliant but possible), the authorize handler has no way to know which site was requested. The handler returns `400 Bad Request: resource parameter required for site routing`. This is the correct behavior — with dynamic site resolution there's no static list to fall back to, and guessing would be worse than failing clearly.

## Proposed API

### `SiteRoutingConfig`

```typescript
export interface SiteRoutingConfig {
  /** Path prefix pattern containing `:siteId` placeholder.
   *  Example: "/sites/:siteId"
   *  The MCP endpoint becomes `{pathPrefix}/mcp` (e.g., "/sites/abc/mcp"). */
  pathPrefix: string;

  /** Resolve a SiteConfig from the extracted site identifier.
   *  Called during authorize (from resource param) and per-request server creation.
   *  Return null to reject unknown sites (404). */
  resolveSite: (
    siteId: string,
    env: HostedMcpEnv
  ) => SiteConfig | null | Promise<SiteConfig | null>;
}
```

### `HostedMcpServerOptions` addition

```typescript
export interface HostedMcpServerOptions {
  // ... existing options ...

  /** URL-based site routing configuration.
   *  Mutually exclusive with `multiSite`. */
  siteRouting?: SiteRoutingConfig;
}
```

### `createSiteRouter` helper

Wraps an OAuthProvider instance to handle path prefix rewriting:

```typescript
export function createSiteRouter(
  oauthProvider: ExportedHandler<HostedMcpEnv>,
  config: SiteRoutingConfig
): ExportedHandler<HostedMcpEnv>;
```

### Consumer usage (worker.ts)

```typescript
import { McpAgent } from "agents/mcp";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  createDefaultHandler,
  createPerRequestServer,
  createSiteRouter,
  getServerOptions,
  type HostedMcpEnv,
  type AuthProps,
} from "@umbraco-cms/mcp-hosted";

const options = {
  name: "umbraco-cloud-mcp",
  version: "1.0.0",
  collections,
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
  enableConsentToolSelection: true,
  siteRouting: {
    pathPrefix: "/sites/:siteId",
    resolveSite: async (siteId, env) => ({
      id: siteId,
      displayName: siteId,
      baseUrl: `https://${siteId}.euwest01.umbraco.io`,
      oauthClientId: env.UMBRACO_OAUTH_CLIENT_ID,
      oauthClientSecret: env.UMBRACO_OAUTH_CLIENT_SECRET,
    }),
  },
};

const serverOptions = getServerOptions(options);

export class UmbracoMcpAgent extends McpAgent<HostedMcpEnv, unknown, AuthProps> {
  server = undefined;
  async init() {
    this.server = await createPerRequestServer(serverOptions, this.env, this.props);
  }
}

const oauthProvider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }),
  defaultHandler: createDefaultHandler(options),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

// Wrap OAuthProvider with site-aware URL rewriting
export default createSiteRouter(oauthProvider, options.siteRouting);
```

### Example: Umbraco Cloud

```typescript
siteRouting: {
  pathPrefix: "/sites/:siteId",
  resolveSite: async (projectAlias, env) => ({
    id: projectAlias,
    displayName: projectAlias,
    baseUrl: `https://${projectAlias}.euwest01.umbraco.io`,
    oauthClientId: env.UMBRACO_OAUTH_CLIENT_ID,
    // Shared secret across all Cloud projects, or per-project from KV:
    oauthClientSecret: env.UMBRACO_OAUTH_CLIENT_SECRET,
  }),
},
```

MCP client connects to `https://mcp.example.com/sites/my-project/mcp`. New Umbraco Cloud projects work automatically — no config changes, no redeployment.

## Implementation details

### `createSiteRouter` internals

```typescript
export function createSiteRouter(
  oauthProvider: ExportedHandler<HostedMcpEnv>,
  config: SiteRoutingConfig
): ExportedHandler<HostedMcpEnv> {
  // Build regex from pathPrefix, e.g. "/sites/:siteId" → /^\/sites\/([^/]+)/
  const prefixPattern = buildPrefixRegex(config.pathPrefix);

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      // Check if path matches the site prefix + /mcp
      // e.g., /sites/abc/mcp → extract "abc", rewrite to /mcp
      const match = url.pathname.match(
        new RegExp(`${prefixPattern.source}\\/mcp$`)
      );

      if (match) {
        const siteId = match[1];
        // Validate site exists
        const site = await config.resolveSite(siteId, env);
        if (!site) {
          return new Response(
            JSON.stringify({ error: `Unknown site: ${siteId}` }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        // Rewrite URL to strip prefix: /sites/abc/mcp → /mcp
        const rewrittenUrl = new URL(request.url);
        rewrittenUrl.pathname = "/mcp";
        const rewrittenRequest = new Request(rewrittenUrl, request);
        return oauthProvider.fetch(rewrittenRequest, env, ctx);
      }

      // All other paths pass through unchanged
      return oauthProvider.fetch(request, env, ctx);
    },
  };
}
```

### Authorize handler changes

The authorize handler (`createAuthorizeHandler`) needs to:

1. Extract the siteId from `authRequest.resource` (the `resource` field is already parsed by OAuthProvider from the MCP client's auth request)
2. Call `resolveSite(siteId, env)` to get the full `SiteConfig` (baseUrl, oauthClientId, oauthClientSecret)
3. Use those credentials to build the Umbraco authorization redirect

```typescript
// In the authorize handler, when siteRouting is configured:
function extractSiteIdFromResource(
  resource: string | string[] | undefined,
  pathPrefix: string
): string | undefined {
  if (!resource) return undefined;
  const url = typeof resource === "string" ? resource : resource[0];
  // Parse the resource URL and match the prefix pattern
  // e.g., "https://host/sites/abc/mcp" → extract "abc"
  const match = new URL(url).pathname.match(
    new RegExp(`${buildPrefixRegex(pathPrefix).source}`)
  );
  return match?.[1];
}
```

On **GET** (consent screen): extract siteId → `resolveSite()` → display site info on the consent screen (no picker, site is already determined). If `resource` is missing, return 400.

On **POST** (user approves): extract siteId from `authRequest.resource` again → `resolveSite()` → use `SiteConfig.baseUrl` and `SiteConfig.oauthClientId` to build the Umbraco authorization URL. Store siteId and site credentials in KV state (same as current multi-site).

The rest of the flow is unchanged — callback reads credentials from KV state, `createPerRequestServer` reads siteId from `AuthProps.consentChoices.siteId`.

### `createPerRequestServer` changes

No changes needed. The siteId arrives via `AuthProps.consentChoices.siteId` (same as current multi-site). The `resolveSite` callback is called again at request time to get the current site config (base URL, credentials, filter overrides).

## Differences from current multi-site

| Aspect | Current multi-site | Path prefix routing |
|--------|-------------------|---------------------|
| Site list | Static (defined in code) | Dynamic (`resolveSite` callback) |
| Site selection | Consent screen picker | Determined by MCP client URL |
| MCP client URL | Same for all sites (`/mcp`) | Unique per site (`/sites/:siteId/mcp`) |
| `.well-known` | One shared discovery | One shared discovery |
| Consent screen | Shows site picker | No site picker (site already known) |
| Callback URL | `/callback/:siteId` | `/callback/:siteId` (same) |
| New sites | Requires code change + deploy | Automatic (dynamic resolution) |

## Considerations

- **Mutual exclusivity**: `siteRouting` and `multiSite` should be mutually exclusive. Validate at startup with a clear error message.
- **`resource` parameter compliance**: The MCP spec (2025-03-26) says clients SHOULD include `resource` in the authorization request. Not all clients may do this yet. The `fallback` option handles this gracefully.
- **Per-project OAuth secrets**: If each Umbraco Cloud project has its own OAuth client secret, `resolveSite` would need to fetch it from KV or an external service. Consider providing a caching wrapper or documenting the latency implications (called on every authorize + every MCP request).
- **Site validation**: `resolveSite` returning `null` produces a 404. For better UX, consider a custom error page with guidance (e.g., "This Umbraco project hasn't been configured for MCP access").
- **Landing page**: The root landing page (`/`) should explain the URL scheme and possibly list known sites (if a static list is available).
- **Configurable routes interaction**: If [Configurable Routes](./configurable-routes.md) is also implemented, the path prefix and custom route paths need to compose correctly (e.g., `pathPrefix + routes.mcp`).
- **McpAgent.serve() path**: The `McpAgent.serve("/mcp")` path must match `apiRoute` (the rewritten path), not the prefixed path. This is already the case in the proposed API.
