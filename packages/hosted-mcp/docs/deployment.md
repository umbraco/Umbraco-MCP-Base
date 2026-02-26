# Deployment Guide

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Build the Worker

```bash
npm run build
```

### 3. Run locally

```bash
npx wrangler dev
```

The Worker runs at `http://localhost:8787`. For local development, you'll need:
- A running Umbraco instance (the `UMBRACO_BASE_URL`)
- The OAuth client registered in Umbraco with `http://localhost:8787/callback` as the redirect URI (see [Umbraco Setup](./umbraco-setup.md))
- A `.dev.vars` file with your secrets

### Self-signed certificate workaround

The workerd runtime (used by `wrangler dev`) cannot connect to HTTPS endpoints with self-signed certificates. If your Umbraco instance uses a self-signed cert (common in local dev), you need an HTTP-to-HTTPS proxy for server-side calls.

Set `UMBRACO_SERVER_URL` in `.dev.vars` to point at the proxy:

```
UMBRACO_BASE_URL=https://localhost:44391
UMBRACO_SERVER_URL=http://localhost:44380
```

`UMBRACO_BASE_URL` is used for browser redirects (user's browser handles the cert). `UMBRACO_SERVER_URL` is used for server-side token exchange (via the HTTP proxy). See [Umbraco Setup - Troubleshooting](./umbraco-setup.md#troubleshooting) for proxy setup instructions.

This is only needed for local dev with self-signed certs. In production, `UMBRACO_BASE_URL` points to a real domain with a valid certificate and `UMBRACO_SERVER_URL` is not needed.

### 4. Test the connection

Use the MCP Inspector in **Direct** mode with URL `http://localhost:8787/mcp`. The Inspector will trigger the OAuth flow automatically.

## Production Deployment

### 1. Create KV namespace

```bash
wrangler kv namespace create OAUTH_KV
```

Copy the returned namespace ID into your `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "abc123..."
```

### 2. Set secrets

```bash
# Umbraco instance URL
wrangler secret put UMBRACO_BASE_URL
# e.g., https://my-umbraco.example.com

# OAuth credentials (must match Umbraco OpenIdDict registration)
wrangler secret put UMBRACO_OAUTH_CLIENT_ID
wrangler secret put UMBRACO_OAUTH_CLIENT_SECRET

# Cookie encryption key (generate with: openssl rand -hex 32)
wrangler secret put COOKIE_ENCRYPTION_KEY
```

### 3. Deploy

```bash
wrangler deploy
```

### 4. Update Umbraco redirect URI

Ensure the production Worker URL is registered as a redirect URI in Umbraco's OpenIdDict configuration:

```
https://my-umbraco-mcp.<your-subdomain>.workers.dev/callback
```

## Environment-Specific Configuration

### Tool filtering via env vars

Set non-secret configuration in `wrangler.toml`:

```toml
[vars]
UMBRACO_TOOL_MODES = "content,media"
UMBRACO_READONLY = "true"
```

Or per environment:

```toml
[env.staging.vars]
UMBRACO_TOOL_MODES = "content,media"
UMBRACO_READONLY = "true"

[env.production.vars]
UMBRACO_TOOL_MODES = "content,media,settings"
```

### Multiple environments

```bash
# Deploy to staging
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

## Custom Domain

### 1. Add a custom domain in Cloudflare dashboard

Workers > your-worker > Settings > Domains & Routes

### 2. Add the domain

```
mcp.example.com
```

### 3. Update Umbraco redirect URI

Register `https://mcp.example.com/callback` as an additional redirect URI.

## Monitoring

### View logs

```bash
wrangler tail
```

### KV token storage

Tokens are stored in KV with automatic TTL expiry. You can inspect stored tokens:

```bash
wrangler kv key list --namespace-id YOUR_KV_NAMESPACE_ID
```

## Known Limitations

- **MCP chaining not supported**: `McpClientManager` uses stdio child processes which are unavailable in Workers runtime.
- **Per-instance deployment**: Each Worker connects to a single Umbraco instance. Multi-tenant is a future extension.
- **Cold starts**: First request to a Durable Object may have slightly higher latency.
