// Add this to your Umbraco project's Program.cs BEFORE `builder.Build()`.
//
// The Cloudflare Workers runtime (workerd) cannot connect to HTTPS endpoints
// with self-signed certificates. This disables the OpenIddict transport security
// requirement in development so workerd can reach the token endpoint over HTTP.
//
// This is safe because it's gated behind IsDevelopment(). Never disable
// transport security in production.

using OpenIddict.Server.AspNetCore;

// ... existing Umbraco builder code ...

// Allow HTTP for token endpoint in development (workerd can't verify self-signed certs).
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddOpenIddict()
        .AddServer(options =>
        {
            options.UseAspNetCore()
                .DisableTransportSecurityRequirement();
        });
}

WebApplication app = builder.Build();
