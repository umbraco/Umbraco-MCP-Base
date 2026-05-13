using Microsoft.Extensions.DependencyInjection;
using OpenIddict.Abstractions;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Notifications;

namespace TestUmbraco;

/// <summary>
/// Registers the MCP Worker as an OpenIdDict authorization_code client
/// so the hosted MCP server can authenticate via Umbraco's backoffice.
/// </summary>
public class McpOAuthComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        // Keep the MCP session alive when the same user signs into the
        // backoffice. With AllowConcurrentLogins = false (the default), every
        // backoffice login revokes *every* OpenIddict token for that user,
        // including the MCP refresh token. Mirrors the workaround shipped in
        // the template/umbraco/Mcp*Composer files.
        builder.Services.Configure<SecuritySettings>(o => o.UserAllowConcurrentLogins = true);

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

        var existing = await _applicationManager.FindByClientIdAsync(clientId, cancellationToken);
        if (existing is not null)
        {
            await _applicationManager.DeleteAsync(existing, cancellationToken);
        }

        var descriptor = new OpenIddictApplicationDescriptor
        {
            ClientId = clientId,
            ClientType = OpenIddictConstants.ClientTypes.Public,
            DisplayName = "Umbraco MCP Server (Test)",
            RedirectUris =
            {
                new Uri("http://localhost:8799/callback"),
                new Uri("http://localhost:8787/callback"),
                new Uri("http://localhost:8788/callback"),
                new Uri("http://127.0.0.1:8799/callback"),
                new Uri("http://127.0.0.1:8787/callback"),
                new Uri("http://127.0.0.1:8788/callback"),
            },
            PostLogoutRedirectUris =
            {
                new Uri("http://localhost:8787/logout-callback"),
                new Uri("http://localhost:8788/logout-callback"),
                new Uri("http://localhost:8799/logout-callback"),
                new Uri("http://127.0.0.1:8787/logout-callback"),
                new Uri("http://127.0.0.1:8788/logout-callback"),
                new Uri("http://127.0.0.1:8799/logout-callback"),
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
