# Token Isolation: How Umbraco Tokens Stay Hidden from MCP Clients

The hosted MCP server uses a **dual-OAuth architecture** that ensures MCP clients never see or handle Umbraco access tokens. This is the core security property of the system and is mandated by the [MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization).

## The Problem

An MCP client (like Claude Desktop or Cursor) needs to call Umbraco Management API endpoints on behalf of a backoffice user. The naive approach would be to pass the Umbraco token directly to the MCP client — but this is dangerous:

- The MCP client could leak the token (logs, telemetry, shared state)
- The token could be reused for API calls outside the MCP server's scope
- A compromised client would have direct Umbraco API access
- The MCP server would have no way to revoke or restrict access

## The Solution: Two Separate OAuth Relationships

The Worker maintains two independent OAuth flows. The MCP client only ever sees tokens from one of them — the Worker's own tokens. The Umbraco tokens exist only inside the Worker and its KV storage.

```mermaid
graph LR
    subgraph "OAuth Relationship 1"
        C[MCP Client] -- "Worker-issued token" --> W[Worker]
    end
    subgraph "OAuth Relationship 2"
        W -- "Umbraco token" --> U[Umbraco]
    end

    style C fill:#e8f4fd,stroke:#1b264f
    style W fill:#1b264f,stroke:#1b264f,color:#fff
    style U fill:#f0e6ff,stroke:#3544b1
```

The Worker is simultaneously:
- An **OAuth Authorization Server** to the MCP client (issues its own tokens)
- An **OAuth Client** to Umbraco (holds Umbraco tokens privately)

## Full Authorization Flow

This sequence shows every step from the MCP client's initial connection through to authenticated tool calls. The critical moment is steps 12–14, where the Umbraco token is stored in KV and only a random reference key is passed back.

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Worker as Cloudflare Worker
    participant KV as Workers KV
    participant Umbraco as Umbraco Backoffice

    Note over Client,Umbraco: Phase 1 — MCP Client discovers the Worker's OAuth server

    Client->>Worker: GET /mcp (no token)
    Worker-->>Client: 401 + OAuth discovery URL

    Client->>Worker: GET /.well-known/oauth-authorization-server
    Worker-->>Client: OAuth metadata (authorize, token, register endpoints)

    Note over Client,Umbraco: Phase 2 — Consent + Umbraco login

    Client->>Worker: GET /authorize
    Worker-->>Client: Consent screen HTML

    Client->>Worker: POST /authorize (user approves)
    Worker->>KV: Store PKCE verifier + auth request
    Worker-->>Client: 302 Redirect to Umbraco /authorize

    Client->>Umbraco: User logs into Umbraco backoffice
    Umbraco-->>Worker: GET /callback?code=AUTH_CODE&state=...

    Note over Worker,KV: Phase 3 — Token exchange (this is where isolation happens)

    Worker->>KV: Consume stored state (PKCE verifier)
    Worker->>Umbraco: POST /token (exchange code for tokens)
    Umbraco-->>Worker: { access_token, refresh_token }

    rect rgb(255, 240, 240)
        Note over Worker,KV: Umbraco tokens stored in KV — never leave the Worker
        Worker->>KV: PUT umbraco_token:{random_key} = { access_token, refresh_token }
    end

    rect rgb(240, 255, 240)
        Note over Worker,Client: Only the random key is passed back — not the token
        Worker->>Worker: completeAuthorization(props: { umbracoTokenKey: random_key })
        Worker-->>Client: 302 Redirect with Worker auth code
    end

    Note over Client,Umbraco: Phase 4 — MCP client gets its own (separate) token

    Client->>Worker: POST /token (exchange Worker auth code)
    Worker-->>Client: Worker-issued access token

    Note over Client,Umbraco: Phase 5 — Authenticated tool calls

    Client->>Worker: POST /mcp + Bearer {Worker token}
    Worker->>KV: GET umbraco_token:{key from props}
    KV-->>Worker: { access_token, refresh_token }
    Worker->>Umbraco: GET /api/v1/... + Bearer {Umbraco token}
    Umbraco-->>Worker: API response
    Worker-->>Client: Tool result (data only, no tokens)
```

## What Each Party Sees

| Party | What it holds | What it never sees |
|-------|--------------|-------------------|
| **MCP Client** | Worker-issued access token | Umbraco access token, refresh token, KV reference key |
| **Worker** | Both tokens (briefly during exchange); KV reference key in props | — |
| **Workers KV** | Umbraco access token + refresh token (keyed by random hex) | Worker-issued tokens |
| **Umbraco** | Its own tokens | Worker-issued tokens, KV reference key |

## The Key Mechanism: Indirection Through KV

The critical design choice is what gets stored in `AuthProps` — the per-user data that the `OAuthProvider` associates with the MCP client's session.

```mermaid
graph TD
    subgraph "What goes into AuthProps (visible to OAuthProvider)"
        A["umbracoTokenKey: 'a3f7b2c1d4e5...'<br/>(random hex string — NOT a token)"]
        B["userId: 'unknown'"]
        C["consentChoices: { selectedModes, readOnly, siteId }"]
    end

    subgraph "What goes into KV (private to Worker)"
        D["umbraco_token:a3f7b2c1d4e5...<br/>{ access_token: 'eyJ...', refresh_token: '...', expires_in: 3600 }"]
    end

    A -. "lookup key" .-> D

    style A fill:#e8f4fd,stroke:#1b264f
    style D fill:#fff0f0,stroke:#cc0000
```

The `umbracoTokenKey` in props is just an opaque random string (64 hex characters from `crypto.getRandomValues`). It has no cryptographic relationship to the Umbraco token — it's purely a lookup key for KV.

## Per-Request Token Retrieval

On every MCP tool call, the Worker reconstructs an authenticated API client from the KV reference:

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Provider as OAuthProvider
    participant Agent as McpAgent (DO)
    participant KV as Workers KV
    participant Umbraco as Umbraco API

    Client->>Provider: POST /mcp + Bearer {Worker token}
    Provider->>Provider: Validate Worker token, extract props
    Provider->>Agent: init(props: { umbracoTokenKey: "a3f7..." })

    Agent->>KV: getStoredUmbracoToken("a3f7...")
    KV-->>Agent: { access_token: "eyJ...", refresh_token: "..." }

    Agent->>Agent: createUmbracoFetchClient({ accessToken: "eyJ..." })
    Agent->>Agent: Register tools, execute handler

    Agent->>Umbraco: GET /api/v1/document/... + Bearer eyJ...
    Umbraco-->>Agent: { name: "Home", ... }
    Agent-->>Client: Tool result: { name: "Home", ... }

    Note over Client: Client sees data, never the Umbraco token
```

If the token has expired, the fetch client handles refresh transparently:

1. API call returns 401
2. Fetch client calls `refreshUmbracoToken()` with the stored refresh token
3. New tokens are written back to the same KV key
4. The original request is retried with the new access token
5. If refresh fails, the error propagates and the user must re-authenticate

## Token Lifetimes

```mermaid
gantt
    title Token Lifetime Comparison
    dateFormat X
    axisFormat %s

    section Worker Token
    Worker access token (managed by OAuthProvider)    :active, 0, 3600

    section Umbraco Tokens in KV
    Umbraco access token (typically 1 hour)           :crit, 0, 3600
    KV TTL buffer (+5 min for refresh)                :done, 3600, 3900
    Refresh token (long-lived, days/weeks)            :active, 0, 86400
```

The KV entry's TTL is set to `expires_in + 300` seconds. The 5-minute buffer ensures the refresh token is still available in KV when the access token expires, giving the fetch client time to refresh before the KV entry is garbage-collected.

## Why This Architecture Matters

### Revocation

The Worker can revoke access by deleting the KV entry. The MCP client's Worker token becomes useless — it resolves to nothing in KV. No need to coordinate with Umbraco's token revocation.

### Scope restriction

The Worker controls which API calls are made. Even if the Umbraco token has broad scopes, the Worker only exposes specific tool handlers. User consent choices further narrow which tools are available.

### Blast radius

If an MCP client is compromised, the attacker gets a Worker token — not an Umbraco token. The Worker token only works with the Worker's MCP endpoint and is useless against Umbraco directly.

### Auditability

All Umbraco API calls originate from the Worker. The Worker can log, rate-limit, and monitor every request without relying on the MCP client to be honest about its token usage.

## Related Documentation

- [Architecture](./architecture.md) — Full auth flow diagram and component architecture
- [Security Model](./security.md) — MCP spec compliance, CSRF protection, SSRF mitigations
- [Auth Internals](./auth-internals.md) — KV state schema, token lifecycle, backoffice endpoint resolution
