# API Reference

## Worker Entry Helpers

### `getServerOptions(options)`

Extracts `CreateServerOptions` from `HostedMcpServerOptions` for passing to `createPerRequestServer`.

```typescript
import { getServerOptions } from "@umbraco-cms/mcp-hosted";

const serverOptions = getServerOptions({
  name: "my-mcp",
  version: "1.0.0",
  collections: [myCollection],
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
});
```

### `createDefaultHandler(options)`

Creates the default route handler for non-MCP routes (callback, landing page).

```typescript
import { createDefaultHandler } from "@umbraco-cms/mcp-hosted";

export default new OAuthProvider({
  // ...
  defaultHandler: createDefaultHandler(options),
});
```

### `HostedMcpServerOptions`

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Server name displayed to MCP clients |
| `version` | `string` | Yes | Server version |
| `collections` | `ToolCollectionExport[]` | Yes | Tool collections to expose |
| `modeRegistry` | `ToolModeDefinition[]` | Yes | Mode registry for tool filtering |
| `allModeNames` | `readonly string[]` | Yes | All valid mode names |
| `allSliceNames` | `readonly string[]` | Yes | All valid slice names |
| `authOptions` | `UmbracoAuthHandlerOptions` | No | OAuth handler options |

## Server Factory

### `createPerRequestServer(options, env, props)`

Creates a fresh McpServer for each request with tools registered and API client configured.

```typescript
import { createPerRequestServer, type CreateServerOptions } from "@umbraco-cms/mcp-hosted";

const server = await createPerRequestServer(serverOptions, env, authProps);
```

Used inside the `McpAgent.init()` method to create a per-request server scoped to the authenticated user.

## Types

### `HostedMcpEnv`

Interface for Cloudflare Worker environment bindings.

```typescript
interface HostedMcpEnv {
  UMBRACO_BASE_URL: string;
  UMBRACO_SERVER_URL?: string;      // HTTP override for server-side calls (local dev)
  UMBRACO_OAUTH_CLIENT_ID: string;
  UMBRACO_OAUTH_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  OAUTH_KV: KVNamespace;
  MCP_AGENT: DurableObjectNamespace;
  OAUTH_PROVIDER: OAuthProviderHelpers;  // Injected by @cloudflare/workers-oauth-provider
  UMBRACO_TOOL_MODES?: string;
  UMBRACO_INCLUDE_SLICES?: string;
  UMBRACO_EXCLUDE_SLICES?: string;
  UMBRACO_READONLY?: string;
}
```

| Binding | Required | Description |
|---------|----------|-------------|
| `UMBRACO_BASE_URL` | Yes | Umbraco instance URL (used for browser redirects) |
| `UMBRACO_SERVER_URL` | No | HTTP URL for server-side calls (token exchange). Use when workerd can't reach `UMBRACO_BASE_URL` (e.g. self-signed cert). |
| `UMBRACO_OAUTH_CLIENT_ID` | Yes | OAuth client ID registered in Umbraco |
| `UMBRACO_OAUTH_CLIENT_SECRET` | Yes | OAuth client secret |
| `COOKIE_ENCRYPTION_KEY` | Yes | Hex string, 32 bytes (`openssl rand -hex 32`) |
| `OAUTH_KV` | Yes | KV namespace for token storage |
| `MCP_AGENT` | Yes | Durable Object namespace |
| `OAUTH_PROVIDER` | Auto | Injected by `@cloudflare/workers-oauth-provider` at runtime |

### `OAuthAuthRequest`

OAuth authorization request from an MCP client, as parsed by the OAuthProvider.

```typescript
interface OAuthAuthRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource?: string | string[];
}
```

### `OAuthProviderHelpers`

Helper methods injected into the Worker environment by `@cloudflare/workers-oauth-provider`.

```typescript
interface OAuthProviderHelpers {
  parseAuthRequest(request: Request): Promise<OAuthAuthRequest>;
  completeAuthorization(options: {
    request: OAuthAuthRequest;
    userId: string;
    metadata: unknown;
    scope: string[];
    props: unknown;
  }): Promise<{ redirectTo: string }>;
  lookupClient(clientId: string): Promise<unknown>;
}
```

These types are defined in this package (rather than imported from the provider) because `@cloudflare/workers-oauth-provider` is a Wrangler virtual module only available at wrangler build time.

### `AuthProps`

Properties returned after successful Umbraco authentication. Available as `this.props` in the McpAgent.

```typescript
interface AuthProps {
  umbracoTokenKey: string;  // KV key for stored Umbraco token
  userId: string;           // Umbraco user subject ID
  userName?: string;        // Umbraco user display name
  userEmail?: string;       // Umbraco user email
}
```

### `HttpResponse<T>` (from `@umbraco-cms/mcp-server-sdk`)

Transport-agnostic HTTP response interface.

```typescript
interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  data: T;
}
```

## HTTP Client

### `createUmbracoFetchClient(config)`

Creates a fetch-based API client for Workers runtime.

```typescript
import { createUmbracoFetchClient } from "@umbraco-cms/mcp-hosted";

const client = createUmbracoFetchClient({
  baseUrl: "https://my-umbraco.example.com",
  accessToken: "stored-access-token",
  refreshContext: {
    env,
    tokenKey: "token-kv-key",
    refreshToken: "stored-refresh-token",
  },
});
```

### `createFetchClientFromKV(env, tokenKey)`

Convenience function that creates a fetch client from stored KV tokens.

```typescript
const client = await createFetchClientFromKV(env, authProps.umbracoTokenKey);
// Returns null if token not found or expired
```

## Config

### `loadWorkerConfig(env)`

Loads tool filtering config from Worker env bindings.

```typescript
import { loadWorkerConfig } from "@umbraco-cms/mcp-hosted";

const config = loadWorkerConfig(env);
// Returns ServerConfigForCollections
```

## Auth Exports

### `createAuthorizeHandler(env, options?)`

Creates the authorize endpoint handler for the Umbraco OAuth flow.

### `createCallbackHandler(env)`

Creates the callback endpoint handler for completing the Umbraco OAuth flow.

### `getStoredUmbracoToken(kv, tokenKey)`

Retrieves a stored Umbraco token from KV.

### `refreshUmbracoToken(env, tokenKey, refreshToken)`

Refreshes an expired Umbraco token.

### `renderConsentScreen(options)` / `consentResponse(options)`

Renders the per-client consent screen HTML.
