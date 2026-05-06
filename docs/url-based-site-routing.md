# URL-Based Site Routing — How It Works

> **Status: proto docs.** Polish before publishing. Covers PR #88.

One hosted MCP Worker, many Umbraco projects. MCP clients connect to a per-project URL — `https://<worker-host>/at/<project-alias>/` — and the worker resolves each project on demand. No site picker on the consent screen, no per-project deployment.

This doc walks through what shipped, the request flow end-to-end, the OAuth audience-validation trick that makes it work, and what an Umbraco Cloud project needs to participate.

---

## Why

Multi-tenant hosted MCP. The previous patterns were:

| Pattern | Per-tenant deploy? | Site picker? | Tokens scoped per site? |
|---|---|---|---|
| Single-site (one Umbraco per Worker) | Yes | n/a | n/a |
| Multi-site with consent picker | No | ✅ User picks at consent | ❌ Shared |
| **URL-based site routing (this PR)** | No | ❌ URL determines site | ✅ Per the MCP spec |

URL-based is the right shape for Umbraco Cloud, where every project already has a known alias.

---

## URL shape

```
https://<worker-host>/at/<project-alias>/
```

- `<project-alias>` is the project's Cloud alias verbatim — `dev-` prefixes for development environments fall out for free.
- The `/at/` prefix is a fixed namespace marker. It avoids collisions with reserved OAuth routes (`/authorize`, `/token`, `/.well-known/*`) — a project literally called `authorize` would be a footgun under bare-path routing, but is fine under `/at/authorize/`.

Examples:

```
https://mcp.example.com/at/hosted-mcp-worker-test/
https://mcp.example.com/at/cloud-setup-training-pjw/
https://mcp.example.com/at/dev-hosted-mcp-worker-test/
```

The MCP client URL is the only thing that changes between projects. Everything else (the consent flow, the discovery doc, the OAuth dance) is shared.

---

## Architecture in four boxes

```
┌──────────────┐    /at/abc/    ┌─────────────────┐    OAuth     ┌──────────────┐    SSO     ┌──────────────────────┐
│  MCP Client  │───────────────▶│  Hosted Worker  │─────────────▶│ Cloud Project│───────────▶│ identity.umbraco.com │
│ (Inspector,  │                │   (Cloudflare)  │              │ (Umbraco CMS)│            │   (Azure B2C)        │
│  Claude, …)  │◀───────────────│                 │◀─────────────│              │◀───────────│                      │
└──────────────┘    tokens      └─────────────────┘   redirect   └──────────────┘  redirect  └──────────────────────┘
```

Three things to know:

1. **The Worker validates per-project access tokens.** The token's `aud` claim binds to `<worker-host>/at/<alias>` (per RFC 8707). This is enforced by `OAuthProvider`'s built-in audience check.
2. **The Worker rewrites `/at/<alias>/` → `/mcp` *internally*** so it can dispatch to a single `McpAgent.serve("/mcp")`. The rewrite happens *after* the audience check, so it doesn't break validation.
3. **The Cloud project must opt in** via two composers (existing OAuth client registration + a small SSO short-circuit). Without the second composer the cold-start flow fails.

---

## The full flow (request-by-request)

Tracing a fresh MCP client connecting to `/at/abc/` for the first time:

```
 1. POST /at/abc/                                                  → 401 Unauthorized
                                                                     WWW-Authenticate: Bearer realm="OAuth"…

 2. GET /.well-known/oauth-protected-resource/at/abc                → 200 {
                                                                       "resource": "https://worker/at/abc",
                                                                       "authorization_servers": ["https://worker"]
                                                                     }
    (RFC 9728 — the worker advertises which resource the client should bind tokens to.)

 3. POST /register                                                  → 201 (DCR for Inspector / similar)
 4. GET  /.well-known/oauth-authorization-server                    → 200 (issuer metadata)
 5. GET  /authorize?…&resource=https://worker/at/abc                → 200 (consent screen)
                                                                     User clicks "Approve".
 6. POST /authorize                                                  → 302 → project's authorize endpoint
                                                                     Worker stores siteId=abc on consentChoices in KV
                                                                     and uses the site's resolved oauthClientId.
 7. GET  https://abc.<region>.umbraco.io/umbraco/management/api/v1
        /security/back-office/authorize?…                           → 302 to Umbraco login
                                                                     (Cloud short-circuit composer appends
                                                                      identity_provider=Umbraco.UmbracoId.)
 8. GET  /umbraco/management/api/v1/security/back-office
        /authorize?…&identity_provider=Umbraco.UmbracoId            → 302 to identity.umbraco.com
 9. Azure B2C login form. User enters Cloud creds, submits.

10. POST /umbraco-signin-oidc                                       → 302 back to project authorize endpoint.
                                                                     The Cloud OIDC handler converts the external
                                                                     login to a back-office cookie sign-in here.
11. GET  /umbraco/management/api/v1/security/back-office/authorize  → 302 to worker /callback/abc?code=…
12. GET  worker /callback/abc?code=…                                → exchanges code for token,
                                                                       302 to Inspector's redirect_uri with auth code

13. POST worker /token                                              → 200 access_token (aud=https://worker/at/abc)

14. POST /at/abc/                                                   → audience matches /at/abc, dispatches to
                                                                       McpAgent.serve("/mcp"), returns tools list.
```

Steps 1–5 happen on the worker. Step 6 hands off to the Cloud project. Steps 7–11 are Cloud-side (the bit your project's composers configure). Step 12 is the worker's callback. Step 14 is what every MCP request looks like once authenticated.

---

## The audience-validation trick

This is the single non-obvious bit. Resource indicators (RFC 8707) require the token's `aud` claim to equal the resource URL the client requested — `https://worker/at/abc`. When the MCP client makes a request, `OAuthProvider` validates the request URL's prefix against the token's `aud`.

The naïve setup would rewrite `/at/abc/` → `/mcp` *before* `OAuthProvider` sees the request, so the token bound to `/at/abc` would fail to validate against the rewritten `/mcp`.

The fix:

```ts
// template/src/worker.ts
const provider = new OAuthProvider({
  apiRoute: ["/mcp", "/at/"],   // Both prefixes are protected resources.
  apiHandler: {
    async fetch(request, env, ctx) {
      // OAuthProvider has already validated the audience against /at/{alias}.
      // Rewrite to /mcp internally so McpAgent.serve("/mcp") dispatches.
      const url = new URL(request.url);
      if (url.pathname.startsWith("/at/")) {
        const rewritten = new URL(request.url);
        rewritten.pathname = "/mcp";
        request = new Request(rewritten.toString(), request);
      }
      return baseApiHandler.fetch(request, env, ctx);
    },
  },
  // …
});
```

The `apiRoute: ["/mcp", "/at/"]` lets `OAuthProvider` recognise both as API routes, and its `matchApiRoute()` does prefix matching — so `/at/abc/anything` is recognised as accessing the `/at/` resource, the token's `aud` is checked against that prefix, and the rewrite happens *inside* `apiHandler` after validation has already passed.

---

## Consumer wiring

In your `worker.ts`:

```ts
import { umbracoCloudSiteRouting } from "@umbraco-cms/mcp-hosted/cloud";

const options = {
  // …name, version, collections, etc.
  siteRouting: umbracoCloudSiteRouting({
    oauthClientId: "umbraco-mcp-cms-hosted",  // see "Cloud project setup" below
    // region: "euwest01",                      // or set env.UMBRACO_CLOUD_REGION
  }),
};
```

That's it for the worker side. The preset takes care of:

- URL composition: `https://{alias}.{region}.umbraco.io`
- Project validation (a `HEAD /umbraco` probe with a 5s timeout)
- Per-isolate caching of resolved sites (60s OK / 30s miss / 10s error, overridable)
- PKCE-by-default — no client_secret needed unless you set `resolveOauthClientSecret`

Override `pathPrefix`, `region`, `validateProject`, or `cacheTtl` if you need to.

---

## Cloud project setup

Each Umbraco Cloud project participating in this needs **two composers**:

### 1. `McpOAuthComposer.cs` — register the OAuth client

The standard pattern. Registers `umbraco-mcp-cms-hosted` (or whatever client_id you chose) as a public/PKCE OpenIddict client, with the worker's `/callback/<alias>` as an allowed redirect URI.

The template ships a generic version at `template/umbraco/McpOAuthComposer.cs`.

### 2. `McpExternalLoginShortCircuitComposer.Cloud.cs` — make cold-start SSO work

This is the non-obvious one. The default cookie scheme behaviour is to redirect unauthenticated requests to `/umbraco/login`, which is served by Umbraco's standalone Login app — and that app doesn't render external login providers. So a cold MCP user lands on a local username/password form they can't fill.

The composer intercepts the redirect and instead bounces back to the same OAuth authorize URL with `identity_provider=Umbraco.UmbracoId` appended. That parameter routes through `BackOfficeController.AuthorizeExternal`, which configures the OIDC challenge correctly and converts the external login to a back-office cookie sign-in via `BackOfficeSignInManager.ExternalLoginSignInAsync`.

The template ships this at `template/umbraco/McpExternalLoginShortCircuitComposer.Cloud.cs` wrapped in a `/* */` block — Cloud users delete the comment markers; self-hosted users leave it alone or delete the file.

### 3. Redirect URI registration

Each project's OpenIddict client needs `http://127.0.0.1:8787/callback/<alias>` (for local dev) and your production worker's `https://<worker-host>/callback/<alias>` (for prod) registered as allowed redirect URIs.

---

## What the worker sees vs. what the user sees

| Layer | Sees | Doesn't see |
|---|---|---|
| MCP client | `/at/abc/`, `/authorize`, `/token`, `/callback/abc` | The internal `/mcp` rewrite, the per-project resolve, the audience check |
| Worker (createWorkerExport) | The original `/at/abc/` URL all the way through to `OAuthProvider` | n/a |
| OAuthProvider's `apiHandler` | Either `/at/abc/<rest>` (siteRouting) or `/mcp` (single-site fallback) | n/a |
| `McpAgent.serve("/mcp")` | Always `/mcp` (after the internal rewrite) | The `/at/<alias>/` URL the client used |

The siteId reaches per-request server creation via `props.consentChoices.siteId`, set during the authorize flow. `createPerRequestServer` calls the same `siteRouting.resolveSite` to look up the project's `baseUrl` for outbound API calls.

---

## Test coverage

| Test | Where | What it covers |
|---|---|---|
| `path-prefix.test.ts` | unit | Regex compilation, siteId extraction from path / `resource` |
| `site-router.test.ts` | unit | Validation (404 on null, 502 on throw), pass-through behaviour |
| `umbraco-handler.test.ts` (siteRouting cases) | unit | GET consent renders site, POST stores siteId, missing/unknown/error responses |
| `cloud.test.ts` | unit | URL composition, region resolution, cache hits/misses, secret hook |
| `cloud-mcp-inspector.test.ts` | E2E | Full real Cloud flow: cold-start → SSO → audience-validated MCP request |

The Cloud E2E auto-skips when env vars (`UMBRACO_CLOUD_TEST_PROJECT/USER/PASSWORD/OAUTH_CLIENT_ID`) aren't set, so CI without secrets stays green.

---

## Trying it locally

```bash
# In the worktree
npm run build -w packages/hosted-mcp
npm run build -w template

# Run the Cloud E2E (needs a Cloud project set up with both composers)
UMBRACO_CLOUD_TEST_PROJECT=hosted-mcp-worker-test \
UMBRACO_CLOUD_TEST_USER=<email> \
UMBRACO_CLOUD_TEST_PASSWORD=<pw> \
UMBRACO_CLOUD_OAUTH_CLIENT_ID=umbraco-mcp-cms-hosted \
npm run test:e2e:cloud
```

For local development against the in-repo Umbraco (no Cloud), the existing single-site `npm run test:e2e` still works unchanged — siteRouting is opt-in.

---

## FAQ / troubleshooting

**Q: I get "Token audience does not match resource server" on the first MCP request after auth.**
A: The worker's `apiRoute` config probably hasn't been updated to include `/at/`. See "Audience-validation trick" above. Ensure `apiRoute: ["/mcp", "/at/"]` and the path rewrite happens inside `apiHandler`, not in `createWorkerExport`.

**Q: Cold-start auth dies on a local Email/Password form.**
A: The Cloud project is missing the short-circuit composer (or `Umbraco.Cloud.Cms` isn't installed). Cookie scheme redirects to `/umbraco/login` and the standalone Login app has no SSO button.

**Q: Auth loops between project authorize and identity.umbraco.com.**
A: The OIDC callback isn't converting the external sign-in to a back-office cookie. Make sure the short-circuit composer is appending `identity_provider=Umbraco.UmbracoId` (which routes through `AuthorizeExternal`), not directly challenging the OIDC scheme.

**Q: Adding a new project — what do I need to do?**
A: Three things, all on the project:
1. Add both composers to the project.
2. Register the standardised OAuth client_id (e.g. `umbraco-mcp-cms-hosted`) in OpenIddict.
3. Add `<worker-host>/callback/<alias>` as an allowed redirect URI.
The worker requires no changes — `umbracoCloudSiteRouting` resolves new aliases on demand.

**Q: Can I use this without Umbraco Cloud?**
A: Yes — use the generic `siteRouting: { pathPrefix, resolveSite }` instead of `umbracoCloudSiteRouting`. Your `resolveSite` returns whatever `SiteConfig` (baseUrl, oauthClientId, optional secret) you want. Audience validation works the same way.

---

## Related files

| File | Purpose |
|---|---|
| `packages/hosted-mcp/src/site-routing/site-router.ts` | Generic `createSiteRouter` + path-prefix helpers |
| `packages/hosted-mcp/src/types/multi-site.ts` | `SiteRoutingConfig`, `SiteRoutingResolver` |
| `packages/hosted-mcp/src/cloud/index.ts` | `umbracoCloudSiteRouting` preset |
| `packages/hosted-mcp/src/server/worker-entry.ts` | PRM endpoint, siteRouting integration in `createWorkerExport` |
| `packages/hosted-mcp/src/auth/umbraco-handler.ts` | `resource`-param siteId extraction in the authorize handler |
| `template/src/worker.ts` | Consumer-facing `OAuthProvider` config |
| `template/umbraco/McpExternalLoginShortCircuitComposer.Cloud.cs` | Cloud-only SSO short-circuit composer |
| `tests/hosted-mcp-e2e/e2e/cloud-mcp-inspector.test.ts` | Cold-start Cloud E2E |

---

## Open questions / follow-ups

- **Documentation:** the standalone Umbraco Login app should render `<umb-extension-slot type="authProvider">` like the SPA does — would remove the need for the project-side short-circuit composer. Worth filing against `umbraco/Umbraco-CMS`.
- **Cloud package:** `Umbraco.Cloud.Cms` could ship the short-circuit composer itself instead of every Cloud project copying it. Worth raising with the Cloud team.
- **Per-project OAuth secrets:** currently the preset assumes one client_id across all projects with PKCE. If a Cloud platform later needs per-project secrets, plug them in via `resolveOauthClientSecret`.
