using OpenIddict.Abstractions;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Notifications;

// TODO: Change this namespace to match your Umbraco project
namespace MyUmbracoProject;

/// <summary>
/// Registers the MCP Worker as an OpenIdDict authorization_code client
/// so the hosted MCP server can authenticate via Umbraco's backoffice.
///
/// Copy this file into your Umbraco project. Umbraco auto-discovers it via IComposer.
///
/// For Cloudflare Tunnel support, add "MCP_TUNNEL_URL" to appsettings.local.json
/// (the scripts/tunnels.sh script does this automatically).
///
/// **For Umbraco Cloud-hosted multi-tenant MCP Workers**, prefer
/// `McpHostedClientsComposer.Cloud.cs` in this directory (and enable
/// `McpExternalLoginShortCircuitComposer.Cloud.cs`). It registers each
/// hosted MCP client (Editor, Dev, etc. — choose which to enable via the
/// `Clients` array) with the tenant-prefixed redirect URIs the Cloud
/// preset's site router expects. It co-exists with this composer —
/// different client ids, no conflict.
/// </summary>
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
    private readonly IConfiguration _configuration;

    public RegisterMcpClientHandler(
        IOpenIddictApplicationManager applicationManager,
        IConfiguration configuration)
    {
        _applicationManager = applicationManager;
        _configuration = configuration;
    }

    public async Task HandleAsync(
        UmbracoApplicationStartingNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            await RegisterClient(cancellationToken);
        }
        catch (Exception ex)
        {
            // During first startup the database may not exist yet (e.g. unattended install).
            // The client will be registered on the next restart after the DB is ready.
            Console.WriteLine($"[McpOAuthComposer] Skipped — {ex.GetType().Name}: {ex.Message}");
        }
    }

    private async Task RegisterClient(CancellationToken cancellationToken)
    {
        const string clientId = "umbraco-back-office-hosted-mcp";

        // Remove any existing registration (e.g. client_credentials from the UI)
        // so we can re-register with authorization_code grant + redirect URI.
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
                new Uri("http://localhost:8787/callback"),
                new Uri("http://localhost:8788/callback"),
                new Uri("http://127.0.0.1:8787/callback"),
                new Uri("http://127.0.0.1:8788/callback"),
            },
            // Required for "Log in as different user" (RP-Initiated Logout)
            PostLogoutRedirectUris =
            {
                new Uri("http://localhost:8787/logout-callback"),
                new Uri("http://localhost:8788/logout-callback"),
                new Uri("http://127.0.0.1:8787/logout-callback"),
                new Uri("http://127.0.0.1:8788/logout-callback"),
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

        // Add tunnel callback URL if configured (set by scripts/tunnels.sh)
        var tunnelUrl = _configuration["MCP_TUNNEL_URL"];
        if (!string.IsNullOrEmpty(tunnelUrl))
        {
            var baseUrl = tunnelUrl.TrimEnd('/');
            descriptor.RedirectUris.Add(new Uri($"{baseUrl}/callback"));
            descriptor.PostLogoutRedirectUris.Add(new Uri($"{baseUrl}/logout-callback"));
        }

        await _applicationManager.CreateAsync(descriptor, cancellationToken);
    }
}
