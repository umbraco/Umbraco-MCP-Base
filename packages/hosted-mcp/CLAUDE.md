# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the `@umbraco-cms/mcp-hosted` package.

## Package Overview

Building blocks for deploying Umbraco MCP servers to Cloudflare Workers with OAuth authentication and Streamable HTTP transport.

## Commands

```bash
npm run build          # Build with tsup
npm run compile        # Type-check only
```

Build from monorepo root: `npm run build -w packages/hosted-mcp`

## Architecture

This package provides **library code** that consumers use in their `worker.ts`. The actual Worker entry point is defined by the consumer because it uses Wrangler virtual modules (`agents/mcp`, `@cloudflare/workers-oauth-provider`) that are only available at wrangler build time.

### What this package provides:
- `createPerRequestServer()` - Per-request McpServer factory
- `createDefaultHandler()` - Route handler for /authorize, /callback, and landing page
- `getServerOptions()` - Config extraction helper
- Auth handlers (Umbraco OAuth flow, consent screen)
- Fetch-based API client (replaces Axios for Workers)
- Worker config loader (env bindings to SDK config)
- Type definitions (`HostedMcpEnv`, `AuthProps`, `OAuthAuthRequest`, `OAuthProviderHelpers`)

### What the consumer provides (in worker.ts):
- `McpAgent` from `agents/mcp` (Wrangler virtual module)
- `OAuthProvider` from `@cloudflare/workers-oauth-provider` (Wrangler virtual module)
- Wiring these together with our building blocks
- Use `McpAgent.serve()` (Streamable HTTP), NOT `.mount()` (SSE legacy alias)
- Pass `{ binding: "MCP_AGENT" }` if the DO binding name differs from the default `MCP_OBJECT`
- Use `new_sqlite_classes` in wrangler.toml migrations (agents library requires SQLite)

## Source Structure

```
src/
├── auth/
│   ├── consent.ts              # Per-client consent screen (mandatory per MCP spec)
│   └── umbraco-handler.ts      # Umbraco OAuth handler (authorize, callback, tokens)
├── config/
│   └── worker-config.ts        # Load filter config from Worker env bindings
├── http/
│   └── umbraco-fetch-client.ts # fetch-based API client for Workers
├── server/
│   ├── create-server.ts        # Per-request McpServer factory
│   └── worker-entry.ts         # Default handler, options helpers
├── types/
│   └── env.ts                  # HostedMcpEnv interface
└── index.ts                    # Public exports
```

## Key Dependencies

- `@umbraco-cms/mcp-server-sdk` - Reuses tool filtering, decorators, types
- `@modelcontextprotocol/sdk` - McpServer for per-request creation
- `@cloudflare/workers-types` (dev) - Type definitions for KV, Durable Objects

## Security

The package implements the MCP Authorization spec's Third-Party Authorization Flow:
- Token passthrough forbidden (Worker issues its own tokens)
- Per-client consent screen before Umbraco redirect
- PKCE for all OAuth flows
- Single-use state parameters with 10-minute TTL
- Umbraco tokens stored in KV, never exposed to MCP clients
