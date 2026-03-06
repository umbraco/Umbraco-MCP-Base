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
        const string clientId = "umbraco-back-office-mcp";

        // Remove any existing registration so we can update it cleanly
        var existing = await _applicationManager.FindByClientIdAsync(clientId, cancellationToken);
        if (existing is not null)
        {
            await _applicationManager.DeleteAsync(existing, cancellationToken);
        }

        var descriptor = new OpenIddictApplicationDescriptor
        {
            ClientId = clientId,
            ClientType = OpenIddictConstants.ClientTypes.Public,
            DisplayName = "Umbraco MCP Server",
            RedirectUris =
            {
                // Production callback URL
                new Uri("https://my-umbraco-mcp.workers.dev/callback"),
                // Local development callback URL
                new Uri("http://localhost:8787/callback"),
            },
            // Required for "Log in as different user" (RP-Initiated Logout)
            PostLogoutRedirectUris =
            {
                new Uri("https://my-umbraco-mcp.workers.dev/logout-callback"),
                new Uri("http://localhost:8787/logout-callback"),
            },
            Permissions =
            {
                OpenIddictConstants.Permissions.Endpoints.Authorization,
                OpenIddictConstants.Permissions.Endpoints.Token,
                OpenIddictConstants.Permissions.Endpoints.Revocation,
                OpenIddictConstants.Permissions.Endpoints.EndSession,
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

The hosted MCP server requires the **authorization code** grant type because end users authenticate interactively through Umbraco's backoffice login. This grant type requires a redirect URI and a **public** client type (PKCE-only, no client secret), neither of which are configurable through the backoffice UI.

### Post-Logout Redirect URIs

The `PostLogoutRedirectUris` and `Endpoints.EndSession` permission are required for the "Log in as different user" feature (`showReauthButton: true` in the Worker). This uses OpenID Connect RP-Initiated Logout to clear Umbraco's session cookie before starting a fresh authorization.

If you don't need user switching, you can omit `PostLogoutRedirectUris` and the `Endpoints.EndSession` permission.

## Multi-Site Setup

When using multi-site deployments, each Umbraco instance needs its own OAuth client registered. The callback URLs include the site ID:

```csharp
RedirectUris =
{
    // Multi-site callback URL (site ID = "prod")
    new Uri("https://my-umbraco-mcp.workers.dev/callback/prod"),
    // Local development
    new Uri("http://localhost:8787/callback/prod"),
},
```

Each site can use different OAuth client IDs. Register a separate Composer (or parameterize a single one) for each Umbraco instance.

## Set Worker Secrets

The Worker's client ID must match the Composer registration above:

```bash
# Umbraco instance URL
wrangler secret put UMBRACO_BASE_URL
# e.g., https://my-umbraco.example.com

# OAuth client ID (must match the Composer)
wrangler secret put UMBRACO_OAUTH_CLIENT_ID
# Enter: umbraco-back-office-mcp

# Cookie encryption key (generate with: openssl rand -hex 32)
wrangler secret put COOKIE_ENCRYPTION_KEY
```

For local development, set these in `.dev.vars`:

```
UMBRACO_BASE_URL=https://localhost:44391
UMBRACO_OAUTH_CLIENT_ID=umbraco-back-office-mcp
COOKIE_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

> **No client secret needed.** The OAuth client is registered as a **public** client with PKCE. There is no `UMBRACO_OAUTH_CLIENT_SECRET`.

## Redirect URI Configuration

The redirect URI registered in the Composer must exactly match the Worker's callback URL:

| Environment | Redirect URI |
|-------------|-------------|
| Production | `https://my-umbraco-mcp.workers.dev/callback` |
| Production (multi-site) | `https://my-umbraco-mcp.workers.dev/callback/:siteId` |
| Custom domain | `https://mcp.example.com/callback` |
| Local dev | `http://localhost:8787/callback` |

You can register multiple redirect URIs in the Composer for different environments.

## Verifying the Setup

1. Restart the Umbraco instance (so the Composer runs)
2. Start the Worker: `npx wrangler dev --port 8787`
3. Visit `http://localhost:8787` — you should see the landing page
4. Use the MCP Inspector in Direct mode with `http://localhost:8787/`
5. The Inspector should trigger the OAuth flow: consent screen → Umbraco login → connected

## Troubleshooting

**"The specified 'redirect_uri' is not valid for this client application" (OpenIdDict ID2043)**
The callback URL sent by the Worker doesn't match any URI in the Composer's `RedirectUris`. Ensure `http://localhost:8787/callback` is listed for local dev. For multi-site, ensure `/callback/:siteId` is registered.

**"Token exchange failed" / TLS errors in local dev**
The Worker (workerd) cannot connect to Umbraco over HTTPS with a self-signed certificate. See [Local Development Setup](./local-dev-setup.md) for the fix — disable OpenIdDict's transport security requirement in dev mode and set `UMBRACO_SERVER_URL` to Umbraco's HTTP port.

**"invalid_client" on token exchange**
Verify the `ClientId` in the Composer matches `UMBRACO_OAUTH_CLIENT_ID` in the Worker's secrets/env vars. Also check that the client is registered as `Public` (not `Confidential`) — a public client uses PKCE and does not require a client secret.

**"Could not find McpAgent binding for MCP_OBJECT"**
The `agents/mcp` library defaults to looking for a Durable Object binding named `MCP_OBJECT`. If your wrangler.toml uses a different name (e.g. `MCP_AGENT`), pass `{ binding: "MCP_AGENT" }` to `McpAgent.serve()`.

**"SQL is not enabled for this Durable Object class"**
Change `new_classes` to `new_sqlite_classes` in the `[[migrations]]` section of `wrangler.toml`. The `agents` library requires SQLite-backed Durable Objects.
