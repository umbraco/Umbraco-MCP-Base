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

**Fix**: Two things are needed:

1. **Disable OpenIdDict's HTTPS requirement** in your Umbraco `Program.cs` (dev only):

```csharp
if (builder.Environment.IsDevelopment())
{
    builder.Services.Configure<OpenIddictServerAspNetCoreOptions>(options =>
    {
        options.DisableTransportSecurityRequirement = true;
    });
}
```

2. **Set `UMBRACO_SERVER_URL`** in `.dev.vars` to point at Umbraco's HTTP port:

```
UMBRACO_BASE_URL=https://localhost:44391
UMBRACO_SERVER_URL=http://localhost:56472
```

`UMBRACO_BASE_URL` (HTTPS) is used for browser redirects. `UMBRACO_SERVER_URL` (HTTP) is used for server-side token exchange. This is only needed for local dev with self-signed certs.

See [Local Development Setup](./local-dev-setup.md) for the full walkthrough.

### "invalid_client" on token exchange

**Cause**: The OAuth client ID in the Worker doesn't match the Umbraco Composer registration, or the client type is wrong.

**Fix**: Verify that `UMBRACO_OAUTH_CLIENT_ID` (in `.dev.vars` or Wrangler secrets) exactly matches the `ClientId` in your `McpOAuthComposer.cs`. Also check that the client is registered as `Public` (not `Confidential`) — the hosted MCP server uses PKCE and does not require a client secret.

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
