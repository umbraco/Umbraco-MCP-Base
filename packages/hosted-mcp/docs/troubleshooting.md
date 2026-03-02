# Troubleshooting

Common errors and their fixes.

## Error Reference

### "The specified 'redirect_uri' is not valid for this client application" (OpenIdDict ID2043)

**Cause**: The callback URL sent by the Worker doesn't match any URI in the Umbraco Composer's `RedirectUris`.

**Fix**:
- For local dev, ensure `http://localhost:8787/callback` is in `RedirectUris`
- For multi-site, ensure `/callback/:siteId` is registered (e.g., `https://my-mcp.workers.dev/callback/prod`)
- For custom domains, ensure the custom domain callback is registered
- The URL must match exactly — no trailing slashes, correct protocol

See [Umbraco Setup - Redirect URI Configuration](./umbraco-setup.md#redirect-uri-configuration) for the full URI table.

### "Token exchange failed" / TLS errors in local dev

**Cause**: The Worker runtime (workerd) cannot connect to HTTPS endpoints with self-signed certificates, which is common in local Umbraco development.

**Fix**: Set `UMBRACO_SERVER_URL` to point server-side calls at an HTTP-to-HTTPS proxy:

```
# .dev.vars
UMBRACO_BASE_URL=https://localhost:44391
UMBRACO_SERVER_URL=http://localhost:44380
```

Then start an HTTP proxy:

```bash
node -e "
const http = require('http');
const https = require('https');
http.createServer((req, res) => {
  const opts = { hostname: 'localhost', port: 44391, path: req.url, method: req.method,
    headers: { ...req.headers, host: 'localhost:44391' }, rejectUnauthorized: false };
  req.pipe(https.request(opts, proxyRes => { res.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(res); }));
}).listen(44380, () => console.log('Proxy on http://localhost:44380'));
"
```

`UMBRACO_BASE_URL` (HTTPS) is still used for browser redirects. `UMBRACO_SERVER_URL` (HTTP) is only used for server-side token exchange. This is only needed for local dev with self-signed certs.

### "invalid_client" on token exchange

**Cause**: The OAuth client ID or secret in the Worker doesn't match the Umbraco Composer registration.

**Fix**: Verify that `UMBRACO_OAUTH_CLIENT_ID` and `UMBRACO_OAUTH_CLIENT_SECRET` (in `.dev.vars` or Wrangler secrets) exactly match the `ClientId` and `ClientSecret` in your `McpOAuthComposer.cs`.

### "Umbraco token not found or expired. Re-authentication required."

**Cause**: The stored Umbraco token has expired from KV or was never stored. Tokens are stored with a TTL based on the token's `expires_in` value plus a 300-second buffer. See [Auth Internals - Token Lifecycle](./auth-internals.md#token-lifecycle) for details.

**Fix**: The user needs to re-authenticate. Disconnect and reconnect the MCP client to trigger a fresh OAuth flow.

### "Could not find McpAgent binding for MCP_OBJECT"

**Cause**: The `agents/mcp` library defaults to looking for a Durable Object binding named `MCP_OBJECT`. Your `wrangler.toml` uses a different name.

**Fix**: Pass the binding name to `McpAgent.serve()`:

```typescript
UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" })
```

The binding name must match `wrangler.toml`:

```toml
[durable_objects]
bindings = [
  { name = "MCP_AGENT", class_name = "UmbracoMcpAgent" }
]
```

### "SQL is not enabled for this Durable Object class"

**Cause**: The `[[migrations]]` section in `wrangler.toml` uses `new_classes` instead of `new_sqlite_classes`.

**Fix**: Change to `new_sqlite_classes`:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["UmbracoMcpAgent"]
```

The `agents` library requires SQLite-backed Durable Objects.

### "Unknown site: xxx"

**Cause**: A callback was received with a `siteId` that doesn't match any configured site in the `multiSite.sites` array.

**Fix**: Ensure the `id` fields in your `multiSite.sites` config match the site IDs used in your Umbraco Composer redirect URIs. For example, if the redirect URI is `/callback/prod`, the site config must have `id: "prod"`.

### "Missing code or state parameter in callback"

**Cause**: The OAuth callback from Umbraco didn't include the expected `code` or `state` query parameters.

**Fix**: This usually indicates the Umbraco authorization was interrupted or the callback URL was accessed directly. Retry the OAuth flow from the beginning.

### "Invalid or expired OAuth state parameter"

**Cause**: The state parameter in the callback doesn't match any stored state, or the 10-minute TTL has expired.

**Fix**: Retry the OAuth flow. State parameters are single-use and expire after 10 minutes. If this happens frequently, check that the Umbraco login flow completes within 10 minutes.
