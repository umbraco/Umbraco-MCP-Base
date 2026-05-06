// =============================================================================
// CLOUD-ONLY composer.
//
// To enable: uncomment everything below and ensure your project references
// `Umbraco.Cloud.Cms` (it provides the "Umbraco.UmbracoId" auth scheme).
// To skip (self-hosted / local dev): leave this file as-is or delete it.
// =============================================================================
//
// When an unauthenticated browser hits the management-API OAuth authorize
// endpoint, the back-office cookie scheme by default redirects to
// /umbraco/login. That URL is served by the standalone Umbraco Login app,
// which has no rendering path for external auth providers — so the user
// lands on a local username/password form and the flow dead-ends.
//
// This composer intercepts the redirect and instead bounces the user back
// to the same authorize URL with identity_provider=Umbraco.UmbracoId
// appended. That second hit is handled by
// Umbraco.Cms.Api.Management.Controllers.Security.BackOfficeController
// .AuthorizeExternal, which:
//   1. Configures the OIDC challenge (with the original authorize URL as
//      the return target),
//   2. After the /umbraco-signin-oidc callback fires, calls
//      BackOfficeSignInManager.ExternalLoginSignInAsync to convert the
//      external claims into a back-office cookie sign-in,
//   3. Then completes the OAuth flow by issuing an authorization code.
//
// Challenging the OIDC scheme directly (e.g. via ChallengeAsync) skips that
// controller path and the back-office cookie never gets set, causing an
// auth loop. Going via the controller is the same path the SPA's working
// /umbraco flow uses — it appends identity_provider when there's exactly
// one available auth provider.
//
// Only intercepts browser GETs (Accept: text/html) for the authorize path,
// and only when identity_provider isn't already in the query (so failure
// modes inside AuthorizeExternal can fall back to the default redirect
// without looping through us).

/*
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;

// TODO: Change this namespace to match your Umbraco project
namespace MyUmbracoProject;

public class McpExternalLoginShortCircuitComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services
            .AddSingleton<IPostConfigureOptions<CookieAuthenticationOptions>,
                McpExternalLoginShortCircuitCookieOptions>();
    }
}

internal sealed class McpExternalLoginShortCircuitCookieOptions
    : IPostConfigureOptions<CookieAuthenticationOptions>
{
    private const string OAuthAuthorizePath =
        "/umbraco/management/api/v1/security/back-office/authorize";

    private const string IdentityProviderParam = "identity_provider";

    // Registered by Umbraco.Cloud.Cms via AddUmbracoId →
    // AddMicrosoftIdentityWebApp(scheme: "Umbraco.UmbracoId").
    private const string ExternalLoginScheme = "Umbraco.UmbracoId";

    private readonly ILogger<McpExternalLoginShortCircuitCookieOptions> _logger;

    public McpExternalLoginShortCircuitCookieOptions(
        ILogger<McpExternalLoginShortCircuitCookieOptions> logger)
    {
        _logger = logger;
    }

    public void PostConfigure(string? name, CookieAuthenticationOptions options)
    {
        if (name != Constants.Security.BackOfficeAuthenticationType)
        {
            return;
        }

        Func<RedirectContext<CookieAuthenticationOptions>, Task> previousLogin =
            options.Events.OnRedirectToLogin;

        options.Events.OnRedirectToLogin = ctx =>
        {
            string path = ctx.Request.Path.Value ?? string.Empty;
            bool isOAuthAuthorize = path.StartsWith(
                OAuthAuthorizePath,
                StringComparison.OrdinalIgnoreCase);
            bool isHtmlGet = HttpMethods.IsGet(ctx.Request.Method)
                && ctx.Request.Headers.Accept.ToString().Contains(
                    "text/html",
                    StringComparison.OrdinalIgnoreCase);
            bool alreadyHasIdentityProvider =
                ctx.Request.Query.ContainsKey(IdentityProviderParam);

            if (!isOAuthAuthorize || !isHtmlGet || alreadyHasIdentityProvider)
            {
                return previousLogin(ctx);
            }

            string pathAndQuery = ctx.Request.Path + ctx.Request.QueryString;
            string redirectUrl = QueryHelpers.AddQueryString(
                pathAndQuery,
                IdentityProviderParam,
                ExternalLoginScheme);

            _logger.LogInformation(
                "[McpAuth] Adding identity_provider to OAuth authorize. Redirect={RedirectUrl}",
                redirectUrl);

            ctx.Response.Redirect(redirectUrl);
            return Task.CompletedTask;
        };
    }
}
*/
