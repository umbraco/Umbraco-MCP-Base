# Chained MCP Consent

## Problem

In a chained MCP scenario, an AI assistant connects to **MCP Server A**, which itself proxies tools from **MCP Server B** (and potentially C, D, etc.). Today, our consent screen only describes the direct relationship: "Application X wants to access your Umbraco instance." It has no awareness of upstream servers in the chain.

This creates several concerns:

1. **Invisible delegation** — The user consents to Server A accessing Umbraco, but Server A silently delegates to Server B. The user never sees or approves this.
2. **Scope laundering** — Server A could request broad permissions, then pass them upstream to Server B which the user would have denied if asked directly.
3. **Confused deputy across hops** — The user trusts Server A, but Server A chains to an untrusted Server B that makes the actual Umbraco API calls with Server A's credentials.
4. **Audit trail gaps** — If something goes wrong, there's no record that the action originated from a chained server rather than the direct client.
5. **Consent for the wrong thing** — The consent screen shows Server A's tool modes/collections, but if Server A is just a passthrough, the real tools come from Server B and may have different names, descriptions, and risk profiles.

### Current state

- MCP chaining (via `McpClientManager`) is **not supported** in the hosted package because Workers can't spawn child processes.
- However, chaining could be implemented via HTTP-based MCP connections (Streamable HTTP) in the future.
- Even without our SDK supporting it natively, a consumer could implement their own chaining in `worker.ts` by making HTTP calls to other MCP servers within tool handlers.

## Scenarios to Consider

### Scenario 1: Our Worker chains to another hosted MCP server

```
AI Client --> Worker A (our hosted-mcp) --> Worker B (another hosted-mcp or any MCP server)
                 |                              |
                 v                              v
           Umbraco Instance A            Umbraco Instance B
```

Worker A has its own consent screen. Worker B has its own consent screen. The user sees Worker A's consent but may never see Worker B's. Worker A makes MCP calls to Worker B using... whose credentials? This is the core problem.

### Scenario 2: External MCP server chains to our Worker

```
AI Client --> External MCP Server --> Our Worker (hosted-mcp)
                                          |
                                          v
                                    Umbraco Instance
```

The external server proxies our tools. The user consented to the external server, but our Worker's consent screen may never be shown (the external server makes API calls to our Worker programmatically).

### Scenario 3: Our Worker aggregates multiple MCP servers

```
AI Client --> Our Worker --> Umbraco Management API
                         --> Third-party MCP Server (e.g. image processing)
                         --> Another Umbraco MCP Worker (different instance)
```

Our Worker exposes a unified tool surface that includes tools from multiple backends. The consent screen currently only knows about our own tool collections.

## Proposed Plan

### Phase 1: Chain-Aware Consent Screen

**Goal:** When our Worker is configured to chain to other MCP servers, the consent screen should disclose this.

#### 1.1 Chain declaration in options

Operators declare upstream MCP servers in their worker configuration:

```typescript
const options: HostedMcpServerOptions = {
  collections: [contentCollection, mediaCollection],
  // New: declare chained servers
  chainedServers?: [
    {
      id: "image-processor",
      displayName: "Image Processing Service",
      description: "Resizes and optimizes images before upload",
      url: "https://image-mcp.example.com",
      // What this server can do (operator-declared, for consent display)
      capabilities: ["read media", "transform images"],
    },
  ],
};
```

#### 1.2 Consent screen rendering

When `chainedServers` is configured, the consent screen adds a new section:

```
--------------------------------------------------
| Authorize Umbraco MCP                          |
|                                                |
| Application: Claude Desktop                    |
| Umbraco Instance: https://cms.example.com      |
|                                                |
| This server also connects to:                  |
| +----------------------------------------------+
| | Image Processing Service                     |
| | https://image-mcp.example.com                |
| | Resizes and optimizes images before upload    |
| +----------------------------------------------+
|                                                |
| [Approve]  [Deny]                              |
--------------------------------------------------
```

#### 1.3 Consent choices for chains

Users should be able to approve/deny individual chained servers:

```typescript
interface ConsentChoices {
  // ... existing fields ...
  /** Chained servers the user approved (null = all approved, [] = none) */
  approvedChainedServers?: string[];
}
```

At runtime, `createPerRequestServer` only enables tools from approved chained servers.

### Phase 2: Downstream Protection (Our Worker as a Target)

**Goal:** When another MCP server chains to our Worker, ensure the end user has still consented.

#### 2.1 The problem

If an external MCP server proxies our tools, it authenticates to our Worker via OAuth. But the OAuth flow is designed for human users — the consent screen expects a person in a browser. A chaining server would need to complete the OAuth flow once (with a human) and then reuse the token for all proxied requests.

This actually works correctly today: our OAuth flow requires a human to log in to Umbraco and approve on the consent screen. The chaining server can't bypass this. The concern is transparency — the user sees "External MCP Server wants to access your Umbraco" but doesn't know their actions are being proxied through another layer.

#### 2.2 Client metadata for chain disclosure

Leverage OAuth Dynamic Client Registration (RFC 7591) metadata to identify chaining clients:

```typescript
interface McpClientMetadata {
  // Standard fields
  client_name: string;
  redirect_uris: string[];
  // New: chain disclosure
  acting_on_behalf_of?: string;  // "Claude Desktop via Aggregator MCP"
  chain_depth?: number;           // How many hops from the end user
}
```

The consent screen could then show: "Aggregator MCP (on behalf of Claude Desktop) wants to access your Umbraco instance."

#### 2.3 Token scope annotations

When a token is issued to a known chaining client, annotate the stored auth props:

```typescript
interface AuthProps {
  // ... existing fields ...
  /** True if the client identified itself as a proxy/aggregator */
  isChainedClient?: boolean;
  /** The end-user-facing client, if known */
  originatingClient?: string;
}
```

This enables audit logging that distinguishes direct vs. proxied access.

### Phase 3: Chain Depth Limits and Trust Policies

**Goal:** Prevent unbounded chaining and establish trust boundaries.

#### 3.1 Maximum chain depth

```typescript
const options: HostedMcpServerOptions = {
  // ...
  chainPolicy?: {
    /** Maximum allowed chain depth (default: 1 = direct only) */
    maxDepth: 2,
    /** Require chained servers to identify themselves */
    requireChainDisclosure: true,
    /** Allowlist of trusted upstream server URLs */
    trustedUpstreams?: string[],
  },
};
```

#### 3.2 Chain verification header

When our Worker calls an upstream MCP server, include a header indicating chain depth:

```
X-MCP-Chain-Depth: 1
X-MCP-Chain-Origin: https://our-worker.example.com
```

When our Worker receives a request, check for these headers and enforce `maxDepth`. This is not a security boundary (headers can be spoofed) but a protocol convention for cooperating servers.

#### 3.3 Trust policies

Define what chained servers are allowed to do:

```typescript
interface ChainedServerConfig {
  id: string;
  displayName: string;
  url: string;
  // Trust constraints
  allowedTools?: string[];        // Only proxy these specific tools
  readOnly?: boolean;             // Force read-only for this chain
  requireUserApproval?: boolean;  // Must be approved on consent screen (default: true)
}
```

### Phase 4: Audit and Observability

**Goal:** Make chained operations traceable.

#### 4.1 Request correlation

Add a correlation ID that flows through the chain:

```typescript
// Generated at the first hop, propagated via header
X-MCP-Correlation-Id: abc-123-def
```

#### 4.2 Audit log entries

When a tool executes via a chain, log:
- Correlation ID
- Chain depth
- Originating client
- Intermediate servers
- Tool name and result status
- User who consented

#### 4.3 User-visible audit

Consider a `/audit` endpoint (or tool) that lets users see what actions were taken on their behalf, including which chain path was used.

## Dependencies and Blockers

| Item | Status | Notes |
|------|--------|-------|
| Streamable HTTP MCP client in Workers | Not yet available | Required for Phase 1 — can't chain via stdio in Workers |
| MCP spec chain semantics | Not yet defined | The MCP spec doesn't currently define chaining conventions |
| OAuth Dynamic Client Registration metadata | Available | OAuthProvider already supports /register |
| Consent screen extensibility | Available | `toolConfig` and `renderConsent` already support custom sections |

## Open Questions

1. **Should chained consent be opt-in or opt-out?** If an operator doesn't declare `chainedServers` but implements chaining in their tool handlers, should we detect and warn? We can't easily detect arbitrary HTTP calls from within tool handlers.

2. **Token delegation vs. separate auth.** Should our Worker pass through its Umbraco token to chained servers, or should each chained server have its own auth? Passing through is simpler but violates token isolation. Separate auth is safer but means the user must consent multiple times.

3. **What if the chained server is also a hosted-mcp Worker?** Two instances of our own package chaining to each other. Should we have a "trusted peer" mode with simplified auth?

4. **MCP spec alignment.** The MCP specification may eventually define its own chaining/delegation semantics. We should track spec development and align with whatever conventions emerge rather than inventing proprietary ones.

5. **Consent fatigue.** If a chain involves 3+ servers, the user faces multiple consent screens. Should we support a "federated consent" model where one consent screen covers the entire chain?

## Recommendation

Start with **Phase 1** (chain-aware consent screen) as soon as Streamable HTTP MCP clients work in Workers. This is the minimum viable improvement: users see what's happening, even if we can't enforce it cryptographically.

**Phase 2** (downstream protection via client metadata) can be implemented independently and improves transparency for the "our Worker as a target" scenario today.

Defer **Phase 3** (chain depth limits, trust policies) until the MCP spec defines chaining conventions — otherwise we risk building proprietary mechanisms that conflict with the standard.

**Phase 4** (audit) is valuable regardless of chaining and could be prioritized separately.
