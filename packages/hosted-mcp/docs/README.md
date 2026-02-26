# Hosted MCP Server for Umbraco

Deploy your Umbraco MCP server to Cloudflare Workers for remote access over the internet.

## What is Hosted MCP?

Hosted MCP enables AI assistants to access your Umbraco instance remotely via the MCP protocol over Streamable HTTP transport. Users authenticate as regular backoffice users through OAuth - no API keys or API users required.

**Local (stdio)** - MCP server runs on the developer's machine, communicates via stdin/stdout. Great for local development.

**Hosted (Cloudflare Workers)** - MCP server runs on the edge, communicates via HTTP. Enables team-wide access, remote AI assistants, and production deployments.

Both modes use the **same tool collections** - no code changes required.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- An Umbraco instance with Management API enabled
- The Umbraco instance must have the hosted MCP server registered as an OAuth client (see [Umbraco Setup](./umbraco-setup.md))

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
wrangler secret put UMBRACO_BASE_URL
wrangler secret put UMBRACO_OAUTH_CLIENT_ID
wrangler secret put UMBRACO_OAUTH_CLIENT_SECRET
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

## Documentation

- [Architecture](./architecture.md) - How the auth flow and server architecture works
- [Security](./security.md) - Security model and MCP spec compliance
- [Umbraco Setup](./umbraco-setup.md) - How to configure your Umbraco instance
- [Deployment](./deployment.md) - Detailed deployment guide
- [API Reference](./api-reference.md) - Package exports and configuration options
