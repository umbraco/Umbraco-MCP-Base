# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the `@umbraco-cms/mcp-hosted` package.

## Package Overview

Building blocks for deploying Umbraco MCP servers to Cloudflare Workers with OAuth authentication and Streamable HTTP transport. Supports consent-screen tool selection, three-tier configuration, and multi-site deployments.

## Commands

```bash
npm run build              # Build with tsup
npm run compile            # Type-check only
npm run test               # Run unit tests (alias for test:unit)
npm run test:unit          # Unit tests (jest, in-package)
npm run test:integration   # Integration tests (wrangler unstable_dev, requires build)
npm run test:e2e           # E2E tests (Playwright, requires running Umbraco + Worker)
```

Build from monorepo root: `npm run build -w packages/hosted-mcp`

## Quality Gates

After every change:
1. TypeScript must compile cleanly: `npm run compile`
2. Unit tests must pass: `npm run test:unit`
3. Integration tests must pass: `npm run test:integration`
4. Never delete or skip a test to make it pass — fix the code or fix the test

E2E tests (`npm run test:e2e`) are run manually — they require a running Umbraco instance and Worker.

## Architecture

This package provides **library code** that consumers use in their `worker.ts`. The actual Worker entry point is defined by the consumer because it uses Wrangler virtual modules (`agents/mcp`, `@cloudflare/workers-oauth-provider`) that are only available at wrangler build time.

### What this package provides:
- `createPerRequestServer()` - Per-request McpServer factory (with consent choice merging; always fetches the connected Umbraco version once per server creation and passes the raw string to `collection.tools(user, { umbracoVersion })` and the per-request store/tool `extra` — `undefined` when the fetch fails, never on the module-scoped tracing adapter; the same fetch feeds a per-request version-mismatch check folded into `instructions` when `expectedUmbracoMajor` is set — see the function's own doc comment for why it avoids the SDK's global `configureVersionCheckHook()`)
- `createWorkerExport()` - URL rewrite wrapper — serves landing page for browser GET `/`, rewrites MCP requests from `/` to `/mcp` for OAuthProvider
- `createDefaultHandler()` - Route handler for /authorize, /callback, and multi-site routes
- `getServerOptions()` - Config extraction helper
- `buildConsentToolConfig()` - Auto-generate consent tool config from mode registry
- `mergeConsentChoices()` - Narrow admin config with user consent choices
- `loadSiteConfig()` - Merge site-specific filter overrides
- Auth handlers (Umbraco OAuth flow, consent screen with tool selection)
- Fetch-based API client for the Workers runtime
- Worker config loader (env bindings to SDK config)
- Type definitions (`HostedMcpEnv`, `AuthProps`, `ConsentChoices`, `SiteConfig`, `MultiSiteConfig`)

### What the consumer provides (in worker.ts):
- `McpAgent` from `agents/mcp` (Wrangler virtual module)
- `OAuthProvider` from `@cloudflare/workers-oauth-provider` (Wrangler virtual module)
- Wrapping the OAuthProvider with `createWorkerExport()` to handle URL rewriting and the landing page
- Wiring these together with our building blocks
- Use `McpAgent.serve()` (Streamable HTTP), NOT `.mount()` (SSE legacy alias)
- Wrap `McpAgent.serve()` in `createSiteRoutingApiHandler()` for the OAuthProvider's `apiHandler`. When a session's Umbraco sign-in is gone, `createPerRequestServer` throws `UmbracoSignInUnavailableError` and serves no tools. Only this wrapper answers `401 invalid_token` and sends the client back to sign-in; without it the session fails every request until the outer grant expires.
- Pass `{ binding: "MCP_AGENT" }` if the DO binding name differs from the default `MCP_OBJECT`
- Use `new_sqlite_classes` in wrangler.toml migrations (agents library requires SQLite)

### Three-tier configuration:
- **Admin** (env vars) - Maximum boundary: modes, slices, read-only
- **Operator** (worker.ts) - What's available: collections, modes, consent features, sites
- **User** (consent screen) - What they get (narrowed within admin + operator bounds)

## Source Structure

```
src/
├── auth/
│   ├── consent.ts              # Per-client consent screen with tool selection
│   ├── token-storage.ts        # KV state management + Umbraco token storage/refresh
│   └── umbraco-handler.ts      # OAuth flow handlers (authorize, callback, consent parsing)
├── config/
│   └── worker-config.ts        # Load filter config + site config from Worker env
├── http/
│   └── umbraco-fetch-client.ts # fetch-based API client for Workers
├── server/
│   ├── create-server.ts        # Per-request McpServer factory + mergeConsentChoices
│   └── worker-entry.ts         # Default handler, multi-site routing, buildConsentToolConfig
├── types/
│   ├── auth.ts                 # Auth types (AuthProps, ConsentChoices, UmbracoAuthHandlerOptions)
│   ├── env.ts                  # HostedMcpEnv interface
│   └── multi-site.ts           # SiteConfig, MultiSiteConfig
└── index.ts                    # Public exports
```

## Key Dependencies

- `@umbraco-cms/mcp-server-sdk` - Reuses tool filtering, decorators, types
- `@modelcontextprotocol/sdk` - McpServer for per-request creation
- `@cloudflare/workers-types` (dev) - Type definitions for KV, Durable Objects

## Security

The package implements the MCP Authorization spec's Third-Party Authorization Flow:
- Token passthrough forbidden (Worker issues its own tokens)
- Per-client consent screen before Umbraco redirect (with optional tool selection)
- PKCE for all OAuth flows
- Single-use state parameters with 10-minute TTL
- Umbraco tokens stored in KV, never exposed to MCP clients
- Consent choices stored in KV state, narrowing-only model (user can't expand admin config). The config loader reads an empty mode or slice list as "no restriction", so a consent selection that shares nothing with the admin's list must resolve to no tools (`mergeConsentChoices`, `registerChainedTools`), never to an empty list
- MCP sessions are bound to the sign-in that started them: `createSiteRoutingApiHandler` hands the client `<session id>.<tag>` (an HMAC keyed by the sign-in's token key) and refuses any request whose tag doesn't match the caller's own sign-in
