# OAuth Discovery Spike

Single-file Cloudflare Worker that answers one question for [issue #100](https://github.com/umbraco/umbraco-mcp-base/issues/100):

> When a per-site PRM advertises `authorization_servers: ["https://<host>/at/<alias>"]`, which `/.well-known/oauth-authorization-server` URL does ChatGPT (or any other MCP client) actually fetch?

The Worker serves three candidate AS discovery URLs simultaneously, each tagged
in the response and in the wrangler logs. Whichever one the client fetches is
the one its discovery code implements.

## Variants

| Tag | URL | Source |
|-----|-----|--------|
| **A** | `/.well-known/oauth-authorization-server` | Single-tenant fallback (client ignored issuer path) |
| **B** | `/.well-known/oauth-authorization-server/at/<alias>` | RFC 8414 §3 strict (well-known segment inserted between host and path) |
| **C** | `/at/<alias>/.well-known/oauth-authorization-server` | Path-after-prefix (intuitive but non-RFC) |

## Deploy

```bash
cd spikes/chatgpt-oauth-discovery
npm install
npx wrangler deploy
```

Note the assigned `*.workers.dev` URL.

## Observe

In a second terminal:

```bash
npx wrangler tail
```

Each request logs a JSON line with a `label` field. Watch for:

- `MCP:trigger` — client hit `/at/demo/mcp`, got the 401 + WWW-Authenticate
- `PRM:per-tenant` — client followed WWW-Authenticate to PRM
- `AS-DISCOVERY:A:root` / `AS-DISCOVERY:B:rfc8414-strict` / `AS-DISCOVERY:C:path-after-prefix` — **this is the answer**
- `AUTHORIZE:tenant-prefixed` — client correctly followed AS metadata to tenant-prefixed authorize
- `AUTHORIZE:root-fallback` — client used variant A and lost the alias

## Test client

Point any MCP client at:

```
https://<your-spike>.workers.dev/at/demo/mcp
```

Try with:
1. ChatGPT's MCP connector (the case from issue #100)
2. Claude Desktop
3. MCP Inspector (`npx @modelcontextprotocol/inspector`)

The spike does not complete OAuth — it returns a friendly HTML page at the
authorize endpoints. We only need to see which URL the client picked.

## Reading the verdict

| Logs show | Meaning | Implication for issue #100 |
|-----------|---------|----------------------------|
| Variant B fetched, then `AUTHORIZE:tenant-prefixed` | RFC-strict client | Issue's proposed `/at/<alias>/.well-known/...` placement is **wrong** — must serve at `/.well-known/oauth-authorization-server/at/<alias>` instead |
| Variant C fetched, then `AUTHORIZE:tenant-prefixed` | Path-after-prefix client | Issue's proposed placement works as written |
| Variant A fetched, then `AUTHORIZE:root-fallback` | Client ignores issuer path | Tenant-pinning approach is fundamentally incompatible with this client; need a different strategy (e.g. host-per-tenant) |
| Both B and C fetched (404 on whichever we don't serve) | Client tries multiple, falls back | Serve both to maximise compatibility |

Cheapest hedge if the answer is ambiguous: serve **both B and C** in the real
implementation. The well-known paths are public and cost nothing.
