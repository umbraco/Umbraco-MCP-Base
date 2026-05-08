/**
 * Spike: which OAuth discovery path does ChatGPT (and other MCP clients) walk?
 *
 * Issue umbraco-mcp-base#100 proposes tenant-pinned `authorization_servers` so
 * non-RFC-8707 clients can complete OAuth on a per-tenant URL. RFC 8414 §3
 * specifies one well-known placement; some clients implement a different one.
 *
 * This Worker serves THREE candidate AS discovery URLs simultaneously, each
 * returning a metadata doc tagged with which variant it is. Whichever variant
 * the client fetches is the one its discovery code actually implements.
 *
 * Variants:
 *   A — /.well-known/oauth-authorization-server                      (root, ignores path)
 *   B — /.well-known/oauth-authorization-server/at/<alias>           (RFC 8414 §3 strict)
 *   C — /at/<alias>/.well-known/oauth-authorization-server           (path-after-prefix)
 *
 * Trigger: MCP request → /at/<alias>/mcp returns 401 with
 *   WWW-Authenticate: Bearer resource_metadata="<PRM-URL>"
 * → client fetches PRM, sees `authorization_servers[0] = <origin>/at/<alias>`,
 *   then walks discovery from there.
 *
 * All requests are logged to wrangler tail. Read the logs to see which AS URL
 * the client fetched, and which authorize endpoint it followed to.
 */

interface Env {
  // No bindings — pure logging spike.
}

const ALIAS_PATTERN = /^\/at\/([^/]+)(\/.*)?$/;

// All three AS discovery paths point at the SAME authorize/token/register
// endpoints (the "ideal" tenant-prefixed ones). The metadata `issuer` field
// is what tells us which discovery URL the client actually fetched.
function buildAsMetadata(origin: string, alias: string, variant: "A" | "B" | "C", selfUrl: string) {
  return {
    _spike_variant: variant,
    _spike_url_fetched: selfUrl,
    issuer: `${origin}/at/${alias}`,
    authorization_endpoint: `${origin}/at/${alias}/authorize`,
    token_endpoint: `${origin}/at/${alias}/token`,
    registration_endpoint: `${origin}/at/${alias}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["openid", "offline_access"],
  };
}

function logRequest(label: string, request: Request, extra: Record<string, unknown> = {}) {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  console.log(
    JSON.stringify({
      label,
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      ua: headers["user-agent"] ?? null,
      headers,
      ...extra,
    })
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const path = url.pathname;

    // ---- Variant A: root AS metadata (no path) -----------------------------
    if (path === "/.well-known/oauth-authorization-server") {
      logRequest("AS-DISCOVERY:A:root", request);
      // Variant A doesn't know the alias — we'd have to single-tenant it.
      // For the spike, hardcode an alias so the response is still well-formed.
      return json(buildAsMetadata(origin, "demo", "A", url.toString()));
    }

    // ---- Variant B: RFC 8414 §3 strict (well-known segment inserted) -------
    // /.well-known/oauth-authorization-server/at/<alias>
    {
      const m = path.match(/^\/\.well-known\/oauth-authorization-server\/at\/([^/]+)\/?$/);
      if (m) {
        const alias = m[1];
        logRequest("AS-DISCOVERY:B:rfc8414-strict", request, { alias });
        return json(buildAsMetadata(origin, alias, "B", url.toString()));
      }
    }

    // ---- Variant C: path-after-prefix -------------------------------------
    // /at/<alias>/.well-known/oauth-authorization-server
    {
      const m = path.match(/^\/at\/([^/]+)\/\.well-known\/oauth-authorization-server\/?$/);
      if (m) {
        const alias = m[1];
        logRequest("AS-DISCOVERY:C:path-after-prefix", request, { alias });
        return json(buildAsMetadata(origin, alias, "C", url.toString()));
      }
    }

    // ---- Protected Resource Metadata (RFC 9728) ---------------------------
    // /.well-known/oauth-protected-resource/at/<alias>
    {
      const m = path.match(/^\/\.well-known\/oauth-protected-resource\/at\/([^/]+)\/?$/);
      if (m) {
        const alias = m[1];
        logRequest("PRM:per-tenant", request, { alias });
        return json({
          resource: `${origin}/at/${alias}`,
          // Tenant-pinned per issue #100 proposal — this is THE thing under test.
          authorization_servers: [`${origin}/at/${alias}`],
          bearer_methods_supported: ["header"],
        });
      }
    }
    if (path === "/.well-known/oauth-protected-resource") {
      logRequest("PRM:root", request);
      return json({
        resource: origin,
        authorization_servers: [origin],
        bearer_methods_supported: ["header"],
      });
    }

    // ---- Tenant authorize endpoint (the "ideal" one) ----------------------
    {
      const m = path.match(/^\/at\/([^/]+)\/authorize\/?$/);
      if (m) {
        const alias = m[1];
        logRequest("AUTHORIZE:tenant-prefixed", request, { alias });
        return new Response(
          `<!doctype html><html><body>
<h1>Spike: tenant-prefixed authorize hit</h1>
<p>Alias: <code>${alias}</code></p>
<p>This is where ChatGPT landed if discovery worked. Spike does not complete OAuth.</p>
<pre>${JSON.stringify(Object.fromEntries(url.searchParams), null, 2)}</pre>
</body></html>`,
          { status: 200, headers: { "content-type": "text/html" } }
        );
      }
    }

    // ---- Root authorize fallback (in case client ignored path) ------------
    if (path === "/authorize") {
      logRequest("AUTHORIZE:root-fallback", request);
      return new Response(
        `<!doctype html><html><body>
<h1>Spike: root authorize hit (NOT what we wanted)</h1>
<p>Client used variant A discovery — fell back to single-tenant authorize.</p>
<pre>${JSON.stringify(Object.fromEntries(url.searchParams), null, 2)}</pre>
</body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }

    // ---- Register: stub success so DCR-required clients (ChatGPT) progress -
    // Returns an RFC 7591-shaped response. Just enough to let the client move
    // on to /authorize, where the landing pages reveal which discovery path
    // it walked. We intentionally do NOT validate or persist anything.
    async function readRegisterBody(): Promise<Record<string, unknown>> {
      try {
        return (await request.clone().json()) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    {
      const m = path.match(/^\/at\/([^/]+)\/register\/?$/);
      if (m) {
        const alias = m[1];
        const body = await readRegisterBody();
        logRequest("REGISTER:tenant-prefixed", request, { alias, body });
        return json({
          _spike: "stub-success",
          client_id: `spike-stub-${alias}`,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          redirect_uris: body.redirect_uris ?? [],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        });
      }
    }
    if (path === "/register") {
      const body = await readRegisterBody();
      logRequest("REGISTER:root", request, { body });
      return json({
        _spike: "stub-success",
        client_id: "spike-stub-root",
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: body.redirect_uris ?? [],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    }

    // ---- Token stub (still 501; spike doesn't complete the flow) ----------
    {
      const m = path.match(/^\/at\/([^/]+)\/token\/?$/);
      if (m) {
        logRequest("TOKEN:tenant-prefixed", request, { alias: m[1] });
        return json({ _spike: "stub", endpoint: "token", alias: m[1] }, 501);
      }
    }
    if (path === "/token") {
      logRequest("TOKEN:root", request);
      return json({ _spike: "stub", endpoint: "token" }, 501);
    }

    // ---- MCP trigger: /at/<alias>/mcp returns 401 with PRM hint ----------
    {
      const m = path.match(/^\/at\/([^/]+)\/mcp\/?$/);
      if (m) {
        const alias = m[1];
        logRequest("MCP:trigger", request, { alias });
        const prmUrl = `${origin}/.well-known/oauth-protected-resource/at/${alias}`;
        return new Response(
          JSON.stringify({ error: "unauthenticated", _spike: "trigger" }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
              "www-authenticate": `Bearer resource_metadata="${prmUrl}"`,
            },
          }
        );
      }
    }

    // ---- Landing page -----------------------------------------------------
    if (path === "/" || path === "") {
      logRequest("LANDING", request);
      return new Response(
        `<!doctype html><html><body>
<h1>OAuth Discovery Spike</h1>
<p>Trigger an MCP discovery flow against this Worker by pointing an MCP client
(ChatGPT MCP connector, Claude Desktop, MCP Inspector, etc.) at:</p>
<pre>${origin}/at/demo/mcp</pre>
<p>Watch <code>wrangler tail</code> to see which AS discovery URL the client walks.</p>
<p>Variants served:</p>
<ul>
  <li>A: <code>/.well-known/oauth-authorization-server</code></li>
  <li>B: <code>/.well-known/oauth-authorization-server/at/&lt;alias&gt;</code> (RFC 8414 §3)</li>
  <li>C: <code>/at/&lt;alias&gt;/.well-known/oauth-authorization-server</code></li>
</ul>
</body></html>`,
        { headers: { "content-type": "text/html" } }
      );
    }

    // ---- Catch-all: log and 404 -------------------------------------------
    logRequest("UNMATCHED", request);
    return json({ error: "not_found", path, _spike: "unmatched-path" }, 404);
  },
};
