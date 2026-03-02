# Hosted MCP Server for Umbraco

Deploy your Umbraco MCP server to Cloudflare Workers for remote access over the internet.

## What is Hosted MCP?

Hosted MCP enables AI assistants to access your Umbraco instance remotely via the MCP protocol over Streamable HTTP transport. Users authenticate as regular backoffice users through OAuth - no API keys or API users required.

**Local (stdio)** - MCP server runs on the developer's machine, communicates via stdin/stdout. Great for local development.

**Hosted (Cloudflare Workers)** - MCP server runs on the edge, communicates via HTTP. Enables team-wide access, remote AI assistants, and production deployments.

Both modes use the **same tool collections** - no code changes required.

## Key Concepts

**Streamable HTTP** — The MCP transport protocol used for hosted servers. Unlike stdio (stdin/stdout for local tools), Streamable HTTP sends MCP messages over standard HTTP requests, enabling remote access.

**Wrangler Virtual Modules** — `agents/mcp` and `@cloudflare/workers-oauth-provider` are provided by Wrangler at build time, not installed via npm. Your TypeScript editor won't resolve them — this is expected. This package re-exports the types you need (like `AuthProps` and `HostedMcpEnv`).

**Three-Tier Configuration** — Tool availability is controlled by three layers, each narrowing the one above:
- **Admin** (env vars) — Maximum boundary set by DevOps
- **Operator** (worker.ts code) — What's available, set by the developer
- **User** (consent screen) — What they get, chosen at authorization time

**Per-Request Server** — Each MCP request creates a fresh `McpServer` instance. Required by the MCP SDK to prevent data leakage between clients.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- An Umbraco instance with Management API enabled
- The Umbraco instance must have the hosted MCP server registered as an OAuth client (see [Umbraco Setup](./docs/umbraco-setup.md))

## Quick Start

### 1. Add the hosted package

```bash
npm install @umbraco-cms/mcp-hosted
```

### 2. Create a Worker entry point

The Worker entry point imports Wrangler virtual modules (`agents/mcp`, `@cloudflare/workers-oauth-provider`) directly and uses building blocks from this package.

```typescript
// src/worker.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  createDefaultHandler,
  createPerRequestServer,
  getServerOptions,
  type HostedMcpEnv,
  type AuthProps,
} from "@umbraco-cms/mcp-hosted";
import myCollection from "./tools/my-collection/index.js";
import { allModes, allModeNames, allSliceNames } from "./config/index.js";

const options = {
  name: "my-umbraco-mcp",
  version: "1.0.0",
  collections: [myCollection],
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
};

const serverOptions = getServerOptions(options);

export class UmbracoMcpAgent extends McpAgent<HostedMcpEnv, unknown, AuthProps> {
  server: McpServer | undefined;
  async init() {
    this.server = await createPerRequestServer(serverOptions, this.env, this.props);
  }
}

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }),
  defaultHandler: createDefaultHandler(options),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
```

### 3. Configure wrangler.toml

```toml
name = "my-umbraco-mcp"
main = "dist/worker.js"
compatibility_date = "2025-02-24"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "OAUTH_KV"
id = "YOUR_KV_NAMESPACE_ID"

[durable_objects]
bindings = [
  { name = "MCP_AGENT", class_name = "UmbracoMcpAgent" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["UmbracoMcpAgent"]
```

> **Important**: Use `new_sqlite_classes` (not `new_classes`). The `agents` library requires SQLite-backed Durable Objects.

> **Important**: The default Durable Object binding name expected by `agents/mcp` is `MCP_OBJECT`. If you use a different name (e.g. `MCP_AGENT`), pass `{ binding: "MCP_AGENT" }` to `.serve()`.

### 4. Set secrets

```bash
# Single-site only (multi-site defines these per site in code)
wrangler secret put UMBRACO_BASE_URL
wrangler secret put UMBRACO_OAUTH_CLIENT_ID
wrangler secret put UMBRACO_OAUTH_CLIENT_SECRET

# Always required
wrangler secret put COOKIE_ENCRYPTION_KEY  # openssl rand -hex 32
```

### 5. Create KV namespace

```bash
wrangler kv namespace create OAUTH_KV
# Update wrangler.toml with the returned namespace ID
```

### 6. Deploy

```bash
wrangler deploy
```

Your MCP server is now accessible at `https://my-umbraco-mcp.<your-subdomain>.workers.dev/mcp`.

Having issues? See [Troubleshooting](./docs/troubleshooting.md).

## Routes

The Worker serves several routes:

| Path | Purpose |
|------|---------|
| `/mcp` | MCP endpoint (Streamable HTTP transport) |
| `/authorize` | OAuth consent screen + redirect to Umbraco |
| `/callback` | Token exchange after Umbraco login |
| `/` | Landing page (server name, version, Umbraco instance) |
| `/info` | Diagnostic JSON endpoint (dev-only, requires `ENABLE_INFO_ENDPOINT=true`) |

The landing page at `/` shows basic server info so operators can verify the deployment is live. For multi-site deployments it lists all configured sites. Custom landing page rendering is a [planned feature](./docs/future/custom-landing-page.md).

The `/info` endpoint returns JSON with available collections, modes, slices, and active config. It is gated behind the `ENABLE_INFO_ENDPOINT` environment variable and returns 404 when not enabled. Add `ENABLE_INFO_ENDPOINT=true` to `.dev.vars` for local development.

## Features

### Consent Screen with Tool Selection

Enable tool selection on the consent screen so users can choose which tool modes they want:

```typescript
const options = {
  name: "my-umbraco-mcp",
  version: "1.0.0",
  collections: [myCollection],
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
  enableConsentToolSelection: true, // Shows mode checkboxes + read-only toggle
};
```

See [Architecture - Three-Tier Configuration](./docs/architecture.md#three-tier-configuration) for how admin, operator, and user configurations interact.

### Multi-Site Support

A single Worker can serve multiple Umbraco instances. All sites share a single MCP endpoint (`/mcp`) — site selection happens during authorization via the consent screen's site picker.

See [Multi-Site Deployments](./docs/multi-site.md) for setup instructions, route structure, and security details.

## Documentation

**Getting Started** (read in order):
1. [Umbraco Setup](./docs/umbraco-setup.md) — Register the Worker as an OAuth client (one-time)
2. [Deployment](./docs/deployment.md) — Deploy, set secrets, verify the connection

**Guides**:
3. [Customization](./docs/customization.md) — Consent screen tool selection, branding, and custom rendering
4. [Multi-Site Deployments](./docs/multi-site.md) — Serve multiple Umbraco instances from one Worker

**Understanding the System**:
5. [Token Isolation](./docs/token-isolation.md) — How Umbraco tokens stay hidden from MCP clients (start here)
6. [Architecture](./docs/architecture.md) — Auth flow, three-tier config, component diagram
7. [Auth Internals](./docs/auth-internals.md) — KV state schema, token lifecycle, consent extraction
8. [Security](./docs/security.md) — Token isolation, PKCE, MCP spec compliance

**Reference**:
9. [API Reference](./docs/api-reference.md) — All exports, types, and interfaces
10. [Troubleshooting](./docs/troubleshooting.md) — Common errors and fixes

**Roadmap**: See [docs/future/](./docs/future/) for planned features.
