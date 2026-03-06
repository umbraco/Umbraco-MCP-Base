# Local Development Setup

Step-by-step guide to running the hosted MCP server locally with `wrangler dev` and a local Umbraco instance.

## Prerequisites

- Node.js 22+
- .NET 10 SDK (for the Umbraco instance)
- A local Umbraco 17+ instance with Management API enabled

## 1. Register the OAuth Client in Umbraco

Copy `umbraco/McpOAuthComposer.cs` from the template into your Umbraco project. Update the namespace to match your project.

The Composer registers the Worker as an authorization_code OAuth client with redirect URIs for `localhost:8787` and `localhost:8788`. Umbraco auto-discovers it via `IComposer` — no changes to `Program.cs` needed.

It also supports Cloudflare Tunnel URLs via the `MCP_TUNNEL_URL` config key in `appsettings.local.json` (set automatically by `scripts/tunnels.sh`).

## 2. Allow HTTP for Token Exchange

The Cloudflare Workers runtime (workerd) cannot connect to HTTPS endpoints with self-signed certificates. The simplest fix is to allow HTTP in your local Umbraco's OpenIdDict configuration.

Add this to your `Program.cs` **after** the Umbraco builder and **before** `app.Build()`:

```csharp
using OpenIddict.Server.AspNetCore;

// ... existing Umbraco builder code ...

// Allow HTTP for local dev so Cloudflare Workers (workerd) can reach
// Umbraco's token endpoint without needing to trust a self-signed cert.
if (builder.Environment.IsDevelopment())
{
    builder.Services.Configure<OpenIddictServerAspNetCoreOptions>(options =>
    {
        options.DisableTransportSecurityRequirement = true;
    });
}

WebApplication app = builder.Build();
```

> **Important**: This is gated behind `IsDevelopment()` so it only applies when `ASPNETCORE_ENVIRONMENT=Development`. Never disable transport security in production.

## 3. Configure the Worker

### `.dev.vars`

Create a `.dev.vars` file in your Worker project root:

```
UMBRACO_BASE_URL=https://localhost:44391
UMBRACO_SERVER_URL=http://localhost:56472
UMBRACO_OAUTH_CLIENT_ID=umbraco-back-office-mcp
COOKIE_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

| Variable | Purpose |
|----------|---------|
| `UMBRACO_BASE_URL` | HTTPS URL used for browser redirects (user's browser handles the self-signed cert) |
| `UMBRACO_SERVER_URL` | HTTP URL used for server-side calls (token exchange, API requests) — avoids the self-signed cert problem |
| `UMBRACO_OAUTH_CLIENT_ID` | Must match the `clientId` in the Composer |
| `COOKIE_ENCRYPTION_KEY` | Any 64-char hex string for local dev (generate properly for production: `openssl rand -hex 32`) |

> **Why two URLs?** `UMBRACO_BASE_URL` (HTTPS) is what the user's browser navigates to — the browser trusts the self-signed cert. `UMBRACO_SERVER_URL` (HTTP) is what workerd uses for server-side calls — workerd doesn't trust self-signed certs, so it uses the HTTP port instead.

### `wrangler.toml`

Ensure your `wrangler.toml` has the standard bindings:

```toml
name = "umbraco-cms-mcp"
main = "src/worker.ts"
compatibility_date = "2025-02-24"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "OAUTH_KV"
id = "local-dev-placeholder"
preview_id = "local-dev-preview"

[durable_objects]
bindings = [
  { name = "MCP_AGENT", class_name = "UmbracoMcpAgent" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["UmbracoMcpAgent"]

[vars]
ENABLE_CONSENT_TOOL_SELECTION = "true"
ENABLE_INFO_ENDPOINT = "true"
```

The KV `id` and `preview_id` values don't matter for local dev — wrangler creates a local SQLite-backed KV store in `.wrangler/`.

### `package.json`

Add a script for convenience:

```json
{
  "scripts": {
    "dev:worker": "wrangler dev"
  }
}
```

## 4. Run It

Start both services:

```bash
# Terminal 1: Start Umbraco
dotnet run --project path/to/your/UmbracoProject

# Terminal 2: Start the Worker
npm run dev:worker
```

## 5. Test the Connection

1. Visit `http://localhost:8787` — you should see the landing page
2. Visit `http://localhost:8787/info` — shows server config and tool collections
3. Use the [MCP Inspector](https://inspector.tools.modelcontextprotocol.io/) in **Direct** mode with URL `http://localhost:8787/`
4. The Inspector triggers the OAuth flow: consent screen → Umbraco login → connected

## 6. Cloudflare Tunnels (for Remote MCP Clients)

Remote MCP clients like ChatGPT can't reach `localhost`. Use `scripts/tunnels.sh` to start Cloudflare tunnels that expose both Umbraco and the Worker:

```bash
# Basic — patches .dev.vars, prints manual Umbraco instructions
./scripts/tunnels.sh

# With Umbraco auto-patching — also sets MCP_TUNNEL_URL in appsettings.local.json
UMBRACO_PROJECT_DIR=/path/to/UmbracoProject ./scripts/tunnels.sh
```

The script:
1. Starts two `cloudflared` quick tunnels (Umbraco + Worker)
2. Patches `UMBRACO_BASE_URL` in `.dev.vars` to the Umbraco tunnel URL
3. Optionally sets `MCP_TUNNEL_URL` in Umbraco's `appsettings.local.json`

After starting, restart both Umbraco (to register the tunnel callback URI) and the Worker (to pick up the new `UMBRACO_BASE_URL`).

Requires [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed.

## Troubleshooting

### "This server only accepts HTTPS requests" (OpenIdDict ID2083)

The `DisableTransportSecurityRequirement` setting in step 2 isn't taking effect. Check:
- `ASPNETCORE_ENVIRONMENT` is set to `Development` in your launch profile
- The `Configure<OpenIddictServerAspNetCoreOptions>` call is before `builder.Build()`
- You restarted the Umbraco instance after the change

### "Token exchange failed" / TLS errors

`UMBRACO_SERVER_URL` is not set or points to the wrong port. Check your `.dev.vars` and verify Umbraco is listening on the HTTP port (check `launchSettings.json`).

### "The specified 'redirect_uri' is not valid" (OpenIdDict ID2043)

The callback URL doesn't match. Ensure `http://localhost:8787/callback` is in the Composer's `RedirectUris`. The port must match — wrangler defaults to 8787.

### "internal error; reference = ..."

This is a generic workerd error. Usually means a server-side fetch failed. Check:
- Umbraco is running and reachable
- `UMBRACO_SERVER_URL` points to the correct HTTP port
- The HTTP transport security requirement is disabled (step 2)

### Consent screen doesn't show tool collections

Set `ENABLE_CONSENT_TOOL_SELECTION = "true"` in `[vars]` in `wrangler.toml`, or pass `enableConsentToolSelection: true` in your worker.ts options.
