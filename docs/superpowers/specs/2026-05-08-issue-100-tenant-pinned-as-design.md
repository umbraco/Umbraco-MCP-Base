# Tenant-Pinned `authorization_servers` for Site-Routed MCP

**Issue:** [umbraco-mcp-base#100](https://github.com/umbraco/Umbraco-MCP-Base/issues/100)
**Spike branch (kept):** [`spike/chatgpt-oauth-discovery`](https://github.com/umbraco/Umbraco-MCP-Base/tree/spike/chatgpt-oauth-discovery)
**Implementation branch:** `feat/100-tenant-pinned-authorization-servers`

## Problem

Site-routed Workers (`/at/<alias>/`) require the OAuth client to send an RFC 8707 `resource` parameter so the authorize handler can pin the auth flow to one Cloud project. Today's `authorize` handler 400s when `resource` is missing.

ChatGPT (May 2026) and other non-RFC-8707 clients walked discovery from PRM to a root `/.well-known/oauth-authorization-server`, lost the alias from the URL, and either dropped `resource` (because root-AS implies single-tenant) or sent a `resource` the root handler couldn't reconcile. Either way: production failure.

## Spike-validated facts

A standalone Worker (kept on `spike/chatgpt-oauth-discovery`) served three candidate AS-discovery URL placements simultaneously and observed which one ChatGPT walks:

- ChatGPT implements **RFC 8414 §3 strict** — fetches `/.well-known/oauth-authorization-server/at/<alias>` (well-known segment **inserted** between host and path), not the path-after-prefix variant `/at/<alias>/.well-known/oauth-authorization-server`.
- ChatGPT does Dynamic Client Registration via `POST /at/<alias>/register` (RFC 7591) before authorizing.
- When the AS is tenant-pinned, ChatGPT **does** send `resource=https://<worker>/at/<alias>`. The "ChatGPT doesn't send resource" failure mode arose from root-AS discovery, not from a missing client capability.

These facts pin down the URL layout and remove the need to hedge with multiple well-known placements.

## Goals

1. ChatGPT and other non-RFC-8707 MCP clients connect to `/at/<alias>/mcp`, walk per-tenant discovery, and complete OAuth without manual intervention.
2. RFC-8707 clients continue to work via the existing `resource`-based path.
3. Mismatched-tenant requests are rejected (defence in depth, not silent passthrough).
4. Per-tenant Dynamic Client Registration: a `client_id` issued via `/at/<A>/register` is invalid at `/at/<B>/authorize`.
5. Zero consumer-side change — `apiRoute: ["/mcp", "/at/"]` and `siteRouting: umbracoCloudSiteRouting({ ... })` remain unchanged.

## Non-goals

- Pushing OpenAI to add `resource`-parameter support to ChatGPT's MCP connector.
- A higher-level `createUmbracoCloudWorker` wrapper (separate follow-up to base#94).
- Migration tooling for already-issued shared registrations — no multi-tenant hosted Worker has shipped, so there's nothing to migrate.

## Design decisions

### DCR scope: per-tenant, defaulted on, no opt-in flag

A registration issued under `/at/<alias>/register` is valid only for that alias's authorize / token endpoints. Reasons:

1. **Spec literal reading** — RFC 8414 §3 says each issuer has its own metadata; our AS metadata advertises `issuer: ${origin}/at/<alias>`. Tenant-scoped clients match.
2. **Revocation hygiene** — revoking one tenant's clients is one KV-key delete; under shared DCR it would require a metadata-filter scan or a worker-wide kick.
3. **Leakage containment** — a leaked `client_id` is bounded to one tenant's blast radius.
4. **Audit / operator UX** — "list clients for tenant A" is a one-liner.
5. **Migration** — shared → scoped is a breaking change for already-issued client_ids. Locking in per-tenant before the first multi-tenant deployment ships is one-way-door cheap.

The "shared DCR saves registrations" UX argument turned out to be theoretical: every MCP client today (ChatGPT, Claude Desktop, Cursor, MCP Inspector) registers per server URL regardless of how the server stores registrations. Per-tenant DCR isn't a regression for any known client.

### Alias-source precedence at authorize / token

The authorize and token handlers extract the tenant alias from up to two sources, in order:

1. **URL prefix** — `/at/<alias>/authorize` → alias = `<alias>` (primary)
2. **`resource` parameter** — RFC 8707 (existing path)

Combinations:

| URL prefix | `resource` param | Behavior |
|------------|------------------|----------|
| `/at/A/...` | absent | Use A. Synthesize `resource = ${origin}/at/A` so the issued token has `aud` set correctly. |
| `/at/A/...` | `${origin}/at/A` (canonical) | Use A. Cross-validation passes. |
| `/at/A/...` | any other string | **Reject** with `invalid_request` — see "Resource match rule" below. |
| `/authorize` (root) | `${origin}/at/A` | Existing behavior — use A from `resource`. |
| `/authorize` (root) | absent | Existing behavior — 400 with "resource required" when `siteRouting` is configured. |

### Resource match rule

When the URL prefix is `/at/<alias>/...`, a non-empty `resource` parameter must be **byte-for-byte equal** to the PRM canonical value `${origin}/at/<alias>` — no normalisation, no trailing-slash tolerance, no path-suffix tolerance. Any other value is rejected with `invalid_request`.

| Sent `resource` | Result against `/at/A/...` |
|-----------------|----------------------------|
| (omitted) | Synthesised — `${origin}/at/A` |
| `${origin}/at/A` | Pass |
| `${origin}/at/A/` | **Reject** (trailing slash differs from canonical PRM value) |
| `${origin}/at/A/mcp` | **Reject** (full endpoint, not the resource identifier) |
| `${origin}/at/B` | **Reject** (mismatched tenant) |
| `https://otherhost/at/A` | **Reject** (host mismatch) |
| `http://<origin>/at/A` (when origin is https) | **Reject** (scheme mismatch) |

Rationale: clients that walk PRM → AS metadata correctly receive and send the canonical value. Strict equality is harder to spoof than a normalisation pipeline, and avoids silent acceptance of variants that signal a confused client (e.g. one inferring `resource` from the MCP request URL rather than the PRM doc).

### Audience synthesis

When the authorize handler is reached via the URL-prefix path with no client-supplied `resource`, the lib **injects `resource = ${origin}/at/<alias>` into the parsed `OAuthAuthRequest` before forwarding to OAuthProvider's `/authorize`**. OAuthProvider then runs its existing flow and produces a token with `aud = ${origin}/at/<alias>` via its standard resource-indicator handling.

Critically, the lib does **not** stamp `aud` itself at token issuance — that would require a deeper hook into OAuthProvider's token machinery. Injecting at the entry forwarder keeps OAuthProvider's role unchanged and reuses its battle-tested resource-indicator path.

Synthesis is server-side only — the client never sees the synthesised value.

### Redirect URI handling

The MCP client passes `redirect_uri` as part of the authorize request. Under tenant routing, the canonical redirect_uri is `${origin}/at/<alias>/callback` (matching the prefixed AS metadata's endpoints). DCR registered the prefixed form, so:

- `/at/<alias>/register` accepts and stores `redirect_uri = ${origin}/at/<alias>/callback` in OAuthProvider's client record
- `/at/<alias>/authorize` forwards `redirect_uri` through to OAuthProvider **unchanged** — the prefix-stripper does NOT rewrite it
- OAuthProvider's redirect_uri allowlist match passes because the registered form is identical
- `/at/<alias>/callback` is routed by the lib's existing tenant dispatch back to the per-tenant callback handler

This avoids needing to teach OAuthProvider that the redirect_uri prefix is "really" a single root path. The path is what the client registered and what comes back; treating it as opaque keeps OAuthProvider's handlers correct.

## Architecture

### Discovery surface

| URL | Status | Behavior |
|-----|--------|----------|
| `/.well-known/oauth-protected-resource/at/<alias>` | Modified | `authorization_servers: [${origin}/at/<alias>]` (was `[${origin}]`) |
| `/.well-known/oauth-authorization-server/at/<alias>` | **New** | RFC 8414 metadata doc, all endpoints prefixed with `/at/<alias>/` |
| `/.well-known/oauth-authorization-server` | Unchanged | OAuthProvider's existing root metadata. Used by single-tenant deployments and (deprecated) clients that ignore PRM `authorization_servers`. |

The new per-tenant AS metadata is rendered by the lib (not OAuthProvider) and returns:

```json
{
  "issuer": "https://<worker>/at/<alias>",
  "authorization_endpoint": "https://<worker>/at/<alias>/authorize",
  "token_endpoint": "https://<worker>/at/<alias>/token",
  "registration_endpoint": "https://<worker>/at/<alias>/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["openid", "offline_access"]
}
```

### Tenant-prefixed OAuth endpoints

A new dispatch layer in `createWorkerExport` matches `/at/<alias>/{authorize,token,register,callback}` **before** the existing `siteRouter.fetch` (which keeps its current job of forwarding `/at/<alias>/mcp` to OAuthProvider with the path intact for audience validation).

| Path | Handling |
|------|----------|
| `/at/<alias>/register` | Validate alias via `siteRouting.resolveSite`. Strip prefix, forward to OAuthProvider's `/register` handler. On 200/201, persist `at:<alias>:client:<client_id> = "1"` binding to `OAUTH_KV` (TTL: none — bindings persist for the registration's lifetime). When OAuthProvider deletes a registration, our binding becomes a tombstone; cleanup is out of scope for this change (binding rows are tiny and the lookup still rejects an unknown client because OAuthProvider's `/authorize` will fail). |
| `/at/<alias>/authorize` | Validate alias. Read `client_id` from query (GET) or form (POST consent submission). Look up `at:<alias>:client:<client_id>` — **reject 400 `invalid_client` if missing**, **reject 400 `invalid_request` if `resource` present and disagrees with URL alias**. Synthesize `resource = ${origin}/at/<alias>` if absent. Strip prefix, forward to OAuthProvider's `/authorize` with the augmented request. The binding check fires on both GET (consent screen render) and POST (consent submission). |
| `/at/<alias>/token` | Validate alias. Read `client_id` from form body. Same binding check. Strip prefix, forward. |
| `/at/<alias>/callback` | Already covered by the existing `/callback/:siteId` shape — route the prefixed variant to the same handler. |
| `/at/<alias>/mcp` | Unchanged. Existing `siteRouter.fetch` validates alias and forwards to OAuthProvider with path intact for audience check. |

### `apiRoute` and OAuthProvider integration

The consumer's `apiRoute: ["/mcp", "/at/"]` doesn't change. The lib intercepts `/at/<alias>/{authorize,token,register,callback,.well-known/...}` **before** OAuthProvider sees them, so OAuthProvider's `/at/`-protection only fires for `/at/<alias>/mcp` (correct) and any other paths under `/at/` that fall through (defensively 401, also correct).

For `register/authorize/token`, the lib strips the prefix to `/{register,authorize,token}` before forwarding — OAuthProvider's existing handlers run unchanged on a request that *looks* root-pathed but carries the synthesized `resource` param that pins the issued token to the correct tenant.

### Tenant binding store

Two records per registration, both written transactionally at `/at/<alias>/register`:

| Key | Value | Purpose |
|-----|-------|---------|
| `at:<alias>:client:<client_id>` | `{"createdAt": <unix-ms>}` | Forward index — answers "is this client allowed at this tenant?" Used at every `/at/<alias>/authorize` and `/at/<alias>/token`. |
| `client:<client_id>:tenant` | `<alias>` | Reverse index — answers "which tenant did this client register under?" Used for revocation, audit, and any future token introspection. |

Doubles the write at registration, which is rare. The forward-only model paints us into a corner the first time we need to revoke or audit by `client_id` alone — adding the reverse index later is fine for new registrations but leaves old ones orphaned, so we add it from day one.

The value is intentionally minimal (a creation timestamp for audit, nothing else) — it's a presence check, not a copy of OAuthProvider's registration record (which OAuthProvider continues to own at its existing flat KV layout). OAuthProvider's flat client-id store is unchanged.

Tenant scope is enforced by the lib's binding check on the way in. The reverse index is read-only at request time; revocation flows write to both keys.

## Module organisation

Two new files plus targeted edits to three existing files. The shared alias-context helper is extracted to `site-routing/internal/` so both `site-routing/` and `tenant-oauth/` can reuse the regex / resolution logic without `tenant-oauth/` reaching into `site-routing/`'s public surface.

```
packages/hosted-mcp/src/
├── site-routing/
│   ├── path-prefix.ts                         [UNCHANGED]
│   ├── site-router.ts                         [UNCHANGED]
│   │   — siteRouter still validates /at/<alias>/mcp and forwards to OAuthProvider
│   └── internal/
│       └── alias-context.ts                   [NEW — shared helper]
│           - resolveAliasFromUrl(url, siteRouting)  — runs prefixRegex, returns { alias, site } or rejection Response
│           - canonicalResourceForAlias(origin, alias)  — returns the strict PRM canonical value
├── tenant-oauth/                              [NEW directory]
│   ├── tenant-router.ts                       [NEW]
│   │   - matchTenantOAuthPath(pathname)       — recognises /at/<alias>/{authorize,token,register,callback,.well-known/...}
│   │   - dispatchTenantOAuth(request, ...)    — alias validation + binding check + prefix strip + forward
│   │   - renderTenantAuthorizationServerMetadata(origin, alias)
│   ├── resource-match.ts                      [NEW]
│   │   - validateResourceMatch(sentResource, canonicalResource)  — strict equals; returns ok / error response
│   ├── binding-store.ts                       [NEW]
│   │   - putClientBinding(kv, alias, clientId)               — writes BOTH forward and reverse keys
│   │   - hasClientBinding(kv, alias, clientId)               — forward lookup
│   │   - getClientTenant(kv, clientId)                       — reverse lookup
│   │   - revokeClient(kv, clientId)                          — deletes both keys (uses reverse to find alias)
│   └── __tests__/
│       ├── tenant-router.test.ts              [NEW]
│       ├── resource-match.test.ts             [NEW]
│       └── binding-store.test.ts              [NEW]
├── server/
│   ├── worker-entry.ts                        [MODIFIED]
│   │   - createWorkerExport: dispatch /at/<alias>/{authorize,token,register,callback} and the new well-known via tenant-router BEFORE siteRouter.fetch
│   │   - renderProtectedResourceMetadata: emit tenant-pinned authorization_servers
│   └── __tests__/
│       └── tenant-discovery.test.ts           [NEW]
└── auth/
    └── umbraco-handler.ts                     [MODIFIED]
        - resolveSiteFromResource → resolveSiteFromContext
          (accept URL-prefix alias as primary source, cross-validate `resource` if present)
        - audience synthesis happens here when alias from URL prefix and `resource` absent
```

`site-routing/`'s mandate stays "parse alias, forward MCP traffic." `tenant-oauth/` owns OAuth mediation: binding store, RFC 8414 metadata, cross-validation, prefix-strip-and-forward. The next person reading `site-routing/` doesn't need to understand OAuth flows to grok alias validation, and vice versa. Dependency direction: `tenant-oauth/` imports from `site-routing/internal/`, never the reverse.

## Error handling

| Condition | Status | Body |
|-----------|--------|------|
| Unknown alias at any `/at/<alias>/...` path | 404 | `{"error": "unknown_site", ...}` (existing siteRouter behavior) |
| `resolveSite` throws | 502 | `{"error": "bad_gateway", ...}` (existing siteRouter behavior) |
| `client_id` not registered for this tenant | 400 | `{"error": "invalid_client", "error_description": "Client not registered for this site"}` |
| `resource` parameter conflicts with URL prefix | 400 | `{"error": "invalid_request", "error_description": "resource parameter does not match site URL"}` |
| `/authorize` (root) without `resource` while `siteRouting` is on | 400 | Existing message (unchanged) |
| `OPTIONS /at/<alias>/.well-known/oauth-authorization-server` | 204 | CORS preflight — `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS` |

## Test plan

Unit tests (Jest, no infra):

- `tenant-oauth/__tests__/tenant-router.test.ts` — path matching, prefix stripping, alias-vs-resource cross-validation, missing-binding rejection, unknown-alias rejection, mismatched-resource rejection, audience synthesis when `resource` absent.
- `tenant-oauth/__tests__/binding-store.test.ts` — put/has, namespacing isolation (binding for `A` not visible at `B`), list-by-alias.
- New: `server/__tests__/tenant-discovery.test.ts` — PRM emits tenant-pinned `authorization_servers`, new well-known returns RFC 8414 doc, dispatch order: tenant-OAuth before siteRouter for prefixed authorize/token/register, after siteRouter for `/mcp`.
- Extend `auth/__tests__/umbraco-handler.test.ts` — `resolveSiteFromContext` with URL-prefix-only / resource-only / both-matching / both-mismatching / neither.

Integration tests (Wrangler `unstable_dev`, no Umbraco):

- New file: `tests/integration/tenant-oauth.test.ts` — full discovery walk (PRM → tenant AS metadata → DCR → authorize), audience claim binding, mismatched-tenant rejection, unbound-client rejection.
- Existing `tests/integration/*.test.ts` — verify root flows unchanged when `siteRouting` is off.

E2E tests (Playwright + running Umbraco):

- New scenario in `e2e/`: tenant-prefixed OAuth completes end-to-end with MCP Inspector pointing at `/at/<alias>/mcp`, no `resource` parameter, no manual config.
- Add fourth axis to existing #94 matrix: `resource` present/absent × URL prefix present/absent.

## Verification checklist

- [ ] `/.well-known/oauth-protected-resource/at/<alias>` advertises `authorization_servers: [${origin}/at/<alias>]`
- [ ] `/.well-known/oauth-authorization-server/at/<alias>` returns 200 unauthenticated, valid RFC 8414 doc, all endpoints tenant-prefixed
- [ ] OPTIONS preflight returns 204 with CORS headers on the new well-known
- [ ] `POST /at/<alias>/register` succeeds and creates BOTH `at:<alias>:client:<client_id>` and `client:<client_id>:tenant` bindings
- [ ] `GET /at/<alias>/authorize?client_id=X` succeeds when X is bound to `<alias>`, fails 400 when bound to a different alias or unbound
- [ ] `redirect_uri` registered at `/at/<alias>/register` is preserved unchanged through `/at/<alias>/authorize` (no prefix stripping)
- [ ] `resource` parameter strict match: trailing-slash variant rejected, `/mcp`-suffix variant rejected, host/scheme mismatch rejected
- [ ] `GET /at/A/authorize?resource=${origin}/at/B` returns 400 `invalid_request` (mismatch)
- [ ] Token issued via `/at/<alias>/authorize` (no `resource` from client) carries `aud = ${origin}/at/<alias>`
- [ ] `/at/<alias>/mcp` accepts the tenant-bound token; `/at/<other>/mcp` rejects it (existing behavior, unchanged)
- [ ] RFC-8707 client (sends `resource`) still completes flow via root `/authorize` when `siteRouting` is on
- [ ] Single-tenant Worker (no `siteRouting`) sees zero behavior change

## Rollout

After this change, the canonical `aud` claim becomes `${origin}/at/<alias>`. Tokens issued under the existing #94 path have whatever `aud` the lib produces today (driven by the client-supplied `resource`, typically `${origin}/at/<alias>` already because clients walk PRM and PRM advertises that as the resource — same shape).

Two scenarios:

1. **Pre-existing tokens whose `aud` matches the new canonical form** — no action, validation continues to pass.
2. **Pre-existing tokens whose `aud` differs** (e.g. clients that sent a slight variant) — these fail audience validation after deployment until they expire and are re-issued by the new flow.

Default access-token TTL is 60 minutes, so the rollout window is naturally bounded. No transitional dual-acceptance is required. Document the window in the PR description for the operator running the deploy; if zero-downtime is critical they can pin a maintenance window equal to the access-token TTL plus a buffer.

Refresh tokens issued under #94 continue to refresh into new-format access tokens via OAuthProvider's existing flow (the refresh path uses the stored authorization grant's resource, which the lib will canonicalise on next use).

## Out of scope

- Per-tenant client_secret rotation / admin UI (future work, opt-in)
- Listing or migrating shared-DCR registrations (none exist)
- A higher-level `createUmbracoCloudWorker` wrapper (separate issue)
- Transitional dual-`aud` acceptance for in-flight tokens (rejected — the natural TTL-bounded rollout is sufficient)
