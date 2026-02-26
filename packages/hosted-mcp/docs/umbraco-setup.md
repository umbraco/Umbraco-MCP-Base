# Umbraco Setup

The Umbraco instance needs the hosted MCP server registered as an OAuth client. This is a one-time setup per Umbraco instance.

## Prerequisites

- Umbraco 14+ with Management API enabled
- Admin access to the Umbraco project source code
- The hosted MCP server's callback URL (e.g., `https://my-umbraco-mcp.workers.dev/callback`)

## Register the OAuth Client

The hosted MCP Worker must be registered as an **Authorization Code** OAuth client in Umbraco's OpenIdDict. This cannot be done through the backoffice UI (which only supports client credentials grants). Instead, register the client in C# code using an Umbraco Composer.

### Add the Composer

Create a file in your Umbraco project (e.g., `McpOAuthComposer.cs`):

```csharp
using OpenIddict.Abstractions;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Notifications;

public class McpOAuthComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.AddNotificationAsyncHandler<UmbracoApplicationStartingNotification,
            RegisterMcpClientHandler>();
    }
}

public class RegisterMcpClientHandler
    : INotificationAsyncHandler<UmbracoApplicationStartingNotification>
{
    private readonly IOpenIddictApplicationManager _applicationManager;

    public RegisterMcpClientHandler(IOpenIddictApplicationManager applicationManager)
    {
        _applicationManager = applicationManager;
    }

    public async Task HandleAsync(
        UmbracoApplicationStartingNotification notification,
        CancellationToken cancellationToken)
    {
        const string clientId = "umbraco-mcp-hosted";

        // Remove any existing registration so we can update it cleanly
        var existing = await _applicationManager.FindByClientIdAsync(clientId, cancellationToken);
        if (existing is not null)
        {
            await _applicationManager.DeleteAsync(existing, cancellationToken);
        }

        var descriptor = new OpenIddictApplicationDescriptor
        {
            ClientId = clientId,
            ClientSecret = "your-secure-client-secret",
            ClientType = OpenIddictConstants.ClientTypes.Confidential,
            DisplayName = "Umbraco MCP Server",
            RedirectUris =
            {
                // Production callback URL
                new Uri("https://my-umbraco-mcp.workers.dev/callback"),
                // Local development callback URL
                new Uri("http://localhost:8787/callback"),
            },
            Permissions =
            {
                OpenIddictConstants.Permissions.Endpoints.Authorization,
                OpenIddictConstants.Permissions.Endpoints.Token,
                OpenIddictConstants.Permissions.Endpoints.Revocation,
                OpenIddictConstants.Permissions.GrantTypes.AuthorizationCode,
                OpenIddictConstants.Permissions.GrantTypes.RefreshToken,
                OpenIddictConstants.Permissions.ResponseTypes.Code,
            }
        };

        await _applicationManager.CreateAsync(descriptor, cancellationToken);
    }
}
```

### How it works

- **Composer auto-discovery**: Umbraco discovers `McpOAuthComposer` automatically via `IComposer` — no changes to `Program.cs` needed.
- **Runs on startup**: The `UmbracoApplicationStartingNotification` handler registers the client each time the application starts, ensuring the configuration is always up to date.
- **Idempotent**: Deletes any existing registration before creating, so it's safe to restart.

### Why not the backoffice UI?

The backoffice Settings > Users page creates **API users** that use the **client credentials** grant type. These are designed for server-to-server authentication (e.g., the stdio MCP server).

The hosted MCP server requires the **authorization code** grant type because end users authenticate interactively through Umbraco's backoffice login. This grant type requires a redirect URI, which is not configurable through the backoffice UI.

## Set Worker Secrets

The Worker's credentials must match the Composer registration above:

```bash
wrangler secret put UMBRACO_OAUTH_CLIENT_ID
# Enter: umbraco-mcp-hosted

wrangler secret put UMBRACO_OAUTH_CLIENT_SECRET
# Enter: your-secure-client-secret
```

For local development, set these in `.dev.vars`:

```
UMBRACO_BASE_URL=https://localhost:44391
UMBRACO_OAUTH_CLIENT_ID=umbraco-mcp-hosted
UMBRACO_OAUTH_CLIENT_SECRET=your-secure-client-secret
COOKIE_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

## Redirect URI Configuration

The redirect URI registered in the Composer must exactly match the Worker's callback URL:

| Environment | Redirect URI |
|-------------|-------------|
| Production | `https://my-umbraco-mcp.workers.dev/callback` |
| Custom domain | `https://mcp.example.com/callback` |
| Local dev | `http://localhost:8787/callback` |

You can register multiple redirect URIs in the Composer for different environments.

## Verifying the Setup

1. Restart the Umbraco instance (so the Composer runs)
2. Start the Worker: `npx wrangler dev --port 8787`
3. Visit `http://localhost:8787` — you should see the landing page
4. Use the MCP Inspector in Direct mode with `http://localhost:8787/mcp`
5. The Inspector should trigger the OAuth flow: consent screen → Umbraco login → connected

## Troubleshooting

**"The specified 'redirect_uri' is not valid for this client application" (OpenIdDict ID2043)**
The callback URL sent by the Worker doesn't match any URI in the Composer's `RedirectUris`. Ensure `http://localhost:8787/callback` is listed for local dev.

**"Token exchange failed" / TLS errors in local dev**
The Worker (workerd) cannot connect to Umbraco over HTTPS with a self-signed certificate. Use the `UMBRACO_SERVER_URL` env var to point server-side calls at an HTTP proxy:

```bash
# Start an HTTP-to-HTTPS proxy
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

Then add to `.dev.vars`:
```
UMBRACO_SERVER_URL=http://localhost:44380
```

`UMBRACO_BASE_URL` (HTTPS) is still used for browser redirects. `UMBRACO_SERVER_URL` (HTTP) is only used for server-side token exchange.

**"invalid_client" on token exchange**
Verify the `ClientId` and `ClientSecret` in the Composer match `UMBRACO_OAUTH_CLIENT_ID` and `UMBRACO_OAUTH_CLIENT_SECRET` in the Worker's secrets/env vars.

**"Could not find McpAgent binding for MCP_OBJECT"**
The `agents/mcp` library defaults to looking for a Durable Object binding named `MCP_OBJECT`. If your wrangler.toml uses a different name (e.g. `MCP_AGENT`), pass `{ binding: "MCP_AGENT" }` to `McpAgent.serve()`.

**"SQL is not enabled for this Durable Object class"**
Change `new_classes` to `new_sqlite_classes` in the `[[migrations]]` section of `wrangler.toml`. The `agents` library requires SQLite-backed Durable Objects.
