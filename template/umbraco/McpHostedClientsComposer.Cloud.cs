// =============================================================================
// CLOUD-ONLY composer — register one or more *hosted* MCP Workers as
// OpenIddict clients so the multi-tenant Cloud-routed flow can authenticate
// against this Umbraco instance.
//
// To enable:
//   1. Uncomment everything below.
//   2. Change the `CloudAlias` constant to the Umbraco Cloud project alias of
//      *this* Umbraco instance (the project name only — no `.<region>`
//      suffix; the Cloud preset adds the region itself).
//   3. Edit the `Clients` array to include only the hosted MCP Workers you
//      want this Umbraco to authenticate. Defaults register both the Editor
//      and the Dev (CMS) Workers — remove either entry to opt out, or add
//      new entries for additional hosted MCPs (Forms, Engage, etc.) as they
//      ship.
//   4. Adjust each entry's `WorkerOrigins` if you use custom domains for the
//      hosted Workers, or want to add new envs (preview, etc.).
//   5. Ensure `McpExternalLoginShortCircuitComposer.Cloud.cs` is also enabled
//      — without it, the back-office cookie scheme dead-ends the auth flow
//      regardless of which clients you've registered here.
//
// To skip (self-hosted / local-only): leave this file as-is or delete it.
// The generic `McpOAuthComposer.cs` covers the self-hosted single-tenant case.
//
// Use this alongside (not instead of) `McpOAuthComposer.cs` if you also want
// a self-hosted Worker — the OpenIddict clients are independent (different
// `client_id`s, different redirect URIs) and don't conflict.
//
// Background: each hosted Cloud-routed MCP Worker authenticates with each
// tenant Umbraco project using a shared `client_id`. The Worker's site
// router rewrites callback URLs to `/callback/<alias>` so the OpenIddict
// registration must allow that path on every Worker origin we deploy to.
// =============================================================================

/*
using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using OpenIddict.Abstractions;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Notifications;

// TODO: Change this namespace to match your Umbraco project
namespace MyUmbracoProject;

public class McpHostedClientsComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        // Keep the hosted MCP session alive when the same user signs into the
        // backoffice. With the default (AllowConcurrentLogins = false), every
        // successful backoffice login fires UserLoginSuccessNotification, which
        // RevokeUserAuthenticationTokensNotificationHandler turns into a
        // FindBySubjectAsync(userKey) + DeleteAsync over *every* OpenIddict
        // token for that user — including the refresh token the hosted Worker
        // is using — so the MCP connection dies as soon as the user opens the
        // backoffice. Relaxing this only for users (members are unaffected)
        // restores concurrent backoffice + MCP sessions.
        builder.Services.Configure<SecuritySettings>(o => o.UserAllowConcurrentLogins = true);

        builder.AddNotificationAsyncHandler<UmbracoApplicationStartingNotification,
            RegisterMcpHostedClientsHandler>();
    }
}

/// <summary>
/// One entry per hosted MCP Worker this Umbraco instance accepts as a
/// federated OpenIddict client. The <see cref="ClientId"/> must match the
/// `oauthClientId` configured in the Worker's `src/worker.ts`. Don't change
/// the default values unless you're forking a Worker to use a private id.
/// </summary>
public record HostedMcpClient(string ClientId, string DisplayName, string[] WorkerOrigins);

public class RegisterMcpHostedClientsHandler
    : INotificationAsyncHandler<UmbracoApplicationStartingNotification>
{
    // TODO: change to your Umbraco Cloud project alias.
    // The bare project name only — the Cloud preset adds `.<region>` itself.
    // This is what surfaces in the Worker's tenant-prefixed callback URL
    // (`{origin}/callback/{CloudAlias}`).
    private const string CloudAlias = "REPLACE_WITH_YOUR_CLOUD_PROJECT_ALIAS";

    // Hosted MCP Workers this Umbraco instance accepts. Remove an entry to
    // opt out of that MCP, or add a new entry for additional MCP types.
    private static readonly HostedMcpClient[] Clients =
    [
        new(
            ClientId: "umbraco-cms-editor-mcp-hosted",
            DisplayName: "Umbraco CMS Editor MCP Worker",
            WorkerOrigins:
            [
                "https://umbraco-cms-editor-mcp.umbraco.workers.dev",
                "https://umbraco-cms-editor-mcp-staging.umbraco.workers.dev",
            ]),
        new(
            ClientId: "umbraco-cms-dev-mcp-hosted",
            DisplayName: "Umbraco CMS Dev MCP Worker",
            WorkerOrigins:
            [
                "https://umbraco-cms-dev-mcp.umbraco.workers.dev",
                "https://umbraco-cms-dev-mcp-staging.umbraco.workers.dev",
            ]),
    ];

    private readonly IOpenIddictApplicationManager _applicationManager;

    public RegisterMcpHostedClientsHandler(IOpenIddictApplicationManager applicationManager)
    {
        _applicationManager = applicationManager;
    }

    public async Task HandleAsync(
        UmbracoApplicationStartingNotification notification,
        CancellationToken cancellationToken)
    {
        foreach (var client in Clients)
        {
            try
            {
                await RegisterClient(client, cancellationToken);
            }
            catch (Exception ex)
            {
                // First startup may run before the database is ready
                // (unattended install). The client will be registered on
                // the next restart.
                Console.WriteLine(
                    $"[McpHostedClientsComposer] Skipped {client.ClientId} — {ex.GetType().Name}: {ex.Message}");
            }
        }
    }

    private async Task RegisterClient(HostedMcpClient client, CancellationToken cancellationToken)
    {
        // Re-register on every startup so changes to URIs take effect
        // without manual cleanup.
        var existing = await _applicationManager.FindByClientIdAsync(client.ClientId, cancellationToken);
        if (existing is not null)
        {
            await _applicationManager.DeleteAsync(existing, cancellationToken);
        }

        var descriptor = new OpenIddictApplicationDescriptor
        {
            ClientId = client.ClientId,
            ClientType = OpenIddictConstants.ClientTypes.Public,
            DisplayName = client.DisplayName,
            Permissions =
            {
                OpenIddictConstants.Permissions.Endpoints.Authorization,
                OpenIddictConstants.Permissions.Endpoints.Token,
                OpenIddictConstants.Permissions.Endpoints.Revocation,
                OpenIddictConstants.Permissions.Endpoints.EndSession,
                OpenIddictConstants.Permissions.GrantTypes.AuthorizationCode,
                OpenIddictConstants.Permissions.GrantTypes.RefreshToken,
                OpenIddictConstants.Permissions.ResponseTypes.Code,
            },
            // Per-client token lifetimes override the server-wide defaults
            // (derived from Umbraco:CMS:Global:TimeOut → 5-minute access
            // tokens / 20-minute refresh window). Hosted MCP sessions sit
            // idle between tool calls, so we extend them here.
            Settings =
            {
                [OpenIddictConstants.Settings.TokenLifetimes.AccessToken]
                    = TimeSpan.FromHours(1).ToString("c", CultureInfo.InvariantCulture),
                [OpenIddictConstants.Settings.TokenLifetimes.RefreshToken]
                    = TimeSpan.FromHours(8).ToString("c", CultureInfo.InvariantCulture),
            }
        };

        foreach (var origin in client.WorkerOrigins)
        {
            // Single-tenant fallback (legacy callback path).
            descriptor.RedirectUris.Add(new Uri($"{origin}/callback"));
            descriptor.PostLogoutRedirectUris.Add(new Uri($"{origin}/logout-callback"));

            // Multi-tenant tenant-prefixed callback used by the Cloud
            // preset's site router. This is the form the hosted Worker
            // actually sends.
            descriptor.RedirectUris.Add(new Uri($"{origin}/callback/{CloudAlias}"));
            descriptor.PostLogoutRedirectUris.Add(new Uri($"{origin}/logout-callback/{CloudAlias}"));
        }

        // Local-dev Worker (`npm run dev:worker`) for testing the
        // tenant-prefixed callback shape against your Cloud-aliased Umbraco.
        descriptor.RedirectUris.Add(new Uri($"http://127.0.0.1:8787/callback/{CloudAlias}"));

        await _applicationManager.CreateAsync(descriptor, cancellationToken);
    }
}
*/
