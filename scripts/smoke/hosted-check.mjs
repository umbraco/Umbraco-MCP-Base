#!/usr/bin/env node
/**
 * End-to-end check of a deployed hosted MCP Worker, as a real MCP client
 * would use it: discovery → DCR → PKCE (S256) authorize → token → MCP over
 * Streamable HTTP, plus the negative cases beta.48's auth hardening covers.
 *
 *   node scripts/smoke/hosted-check.mjs <mcp-url> [--call <tool> '<json>']...
 *        [--save <name>] [--cross <name>] [--min-tools N]
 *
 * The authorize URL is printed (and written to <state-dir>/authorize-url.txt);
 * open it in a browser, approve consent, sign in to Umbraco. The redirect
 * lands on a loopback listener here. Tokens are kept in <state-dir> (mode
 * 600) and never printed.
 *
 *   --save <name>   keep this sign-in's token + MCP session as <name>
 *   --cross <name>  also check that <name>'s MCP session is refused with
 *                   THIS sign-in's token (session bound to its sign-in, #464)
 *
 * Exit code 1 on any failed check.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../package.json"));
const { Validator } = await import(require.resolve("@cfworker/json-schema"));

const argv = process.argv.slice(2);
const mcpUrl = argv[0];
// https for deployed Workers; plain http only for a local `wrangler dev`.
if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(mcpUrl ?? "")) {
  console.error("usage: hosted-check.mjs <https://…/mcp> [--call tool json]... [--save name] [--cross name]");
  process.exit(2);
}
const calls = [];
let save, cross;
let minTools = 1;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--call") calls.push({ tool: argv[++i], args: JSON.parse(argv[++i] ?? "{}") });
  else if (argv[i] === "--save") save = argv[++i];
  else if (argv[i] === "--cross") cross = argv[++i];
  else if (argv[i] === "--min-tools") minTools = Number(argv[++i]);
}

const stateDir = process.env.SMOKE_HOSTED_STATE ?? join(homedir(), "Projects/mcp-smoke/.hosted-state");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });

const failures = [];
const fail = (m) => (failures.push(m), console.log(`  FAIL ${m}`));
const pass = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? pass(m) : fail(m));
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function mcp(token, body, sessionId) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-11-25",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(mcpUrl, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let msg;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const m = JSON.parse(line.slice(5));
      if (m.id === body.id) msg = m;
    }
  } else if (text) {
    try {
      msg = JSON.parse(text);
    } catch {
      msg = { raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), www: res.headers.get("www-authenticate"), msg };
}

const initBody = (id = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} }, clientInfo: { name: "mcp-smoke-hosted", version: "0" } },
});

console.log(`\nhosted-check ${mcpUrl}`);

// --- 1. discovery -----------------------------------------------------------
const anon = await mcp(null, initBody());
check(anon.status === 401, `unauthenticated initialize → ${anon.status} (want 401)`);
const rm = anon.www?.match(/resource_metadata="([^"]+)"/)?.[1];
check(Boolean(rm), `WWW-Authenticate carries resource_metadata`);
const prm = await (await fetch(rm)).json();
const asBase = prm.authorization_servers?.[0];
const asUrl = new URL(asBase);
const asMeta = await (await fetch(`${asUrl.origin}/.well-known/oauth-authorization-server${asUrl.pathname.replace(/\/$/, "")}`)).json();
check(Boolean(asMeta.registration_endpoint && asMeta.authorization_endpoint && asMeta.token_endpoint), `per-tenant AS metadata has register/authorize/token`);
check(
  JSON.stringify(asMeta.code_challenge_methods_supported) === JSON.stringify(["S256"]),
  `AS advertises S256 only (got ${JSON.stringify(asMeta.code_challenge_methods_supported)})`,
);

const bad = await mcp("not-a-real-token", initBody());
check(bad.status === 401, `garbage bearer token → ${bad.status} (want 401)`);

// --- 2. DCR + loopback ------------------------------------------------------
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
const reg = await (
  await fetch(asMeta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "mcp-smoke-hosted",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
).json();
check(Boolean(reg.client_id), `dynamic client registration → client_id`);

// plain PKCE must be refused before any consent/sign-in happens
{
  const u = new URL(asMeta.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri, code_challenge: "plain-challenge-plain-challenge-plain-challenge-1", code_challenge_method: "plain", state: "p", resource: mcpUrl.replace(/\/mcp$/, "") })) u.searchParams.set(k, v);
  const r = await fetch(u, { redirect: "manual" });
  const loc = r.headers.get("location") ?? "";
  const refused = r.status >= 400 || /error=/.test(loc);
  check(refused, `authorize with code_challenge_method=plain is refused (${r.status}${loc ? " → " + loc.slice(0, 80) : ""})`);
}

const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(12));
const authUrl = new URL(asMeta.authorization_endpoint);
for (const [k, v] of Object.entries({
  response_type: "code",
  client_id: reg.client_id,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
  scope: (asMeta.scopes_supported ?? []).join(" "),
  resource: mcpUrl.replace(/\/mcp$/, ""),
})) if (v) authUrl.searchParams.set(k, v);

writeFileSync(join(stateDir, "authorize-url.txt"), authUrl.toString());
console.log(`\n  >>> open in a browser and complete consent + sign-in:\n  ${authUrl}\n`);

const code = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("no OAuth callback within 10 minutes")), 600_000);
  server.on("request", (req, res) => {
    const u = new URL(req.url, redirectUri);
    if (u.pathname !== "/callback") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<h1>mcp-smoke: signed in, you can close this tab.</h1>");
    clearTimeout(t);
    if (u.searchParams.get("state") !== state) return reject(new Error("state mismatch on callback"));
    if (u.searchParams.get("error")) return reject(new Error(`authorize error: ${u.searchParams.get("error")} ${u.searchParams.get("error_description") ?? ""}`));
    resolve(u.searchParams.get("code"));
  });
}).finally(() => server.close());
pass(`authorization code received on loopback`);

// --- 3. token + refresh -----------------------------------------------------
async function tokenRequest(params) {
  const r = await fetch(asMeta.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const replayParams = { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier };
const tok = await tokenRequest(replayParams);
check(tok.status === 200 && Boolean(tok.body.access_token), `token exchange → access_token${tok.body.refresh_token ? " + refresh_token" : ""} (${tok.status}${tok.status !== 200 ? " " + JSON.stringify(tok.body).slice(0, 150) : ""})`);
const replay = await tokenRequest(replayParams);
check(replay.status >= 400, `authorization code cannot be replayed (${replay.status})`);
let accessToken = tok.body.access_token;

if (tok.body.refresh_token) {
  const ref = await tokenRequest({ grant_type: "refresh_token", refresh_token: tok.body.refresh_token, client_id: reg.client_id });
  check(ref.status === 200 && Boolean(ref.body.access_token), `refresh_token grant → new access_token`);
  if (ref.body.access_token) accessToken = ref.body.access_token;
}

// --- 4. MCP -----------------------------------------------------------------
const init = await mcp(accessToken, initBody());
check(init.status === 200 && Boolean(init.msg?.result), `initialize with token → ${init.status} ${init.msg?.result?.serverInfo?.name ?? JSON.stringify(init.msg).slice(0, 150)}`);
const sid = init.sessionId;
check(Boolean(sid), `server issued an mcp-session-id`);
if (init.msg?.result?.instructions) console.log(`       instructions: ${init.msg.result.instructions.replace(/\s+/g, " ").slice(0, 200)}`);
await fetch(mcpUrl, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${accessToken}`, "mcp-session-id": sid, "mcp-protocol-version": "2025-11-25" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});

const list = await mcp(accessToken, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sid);
const tools = list.msg?.result?.tools ?? [];
check(tools.length >= minTools, `tools/list → ${tools.length} tools (min ${minTools})`);
const byName = new Map(tools.map((t) => [t.name, t]));

let id = 10;
for (const c of calls) {
  const tool = byName.get(c.tool);
  if (!tool) {
    fail(`call ${c.tool}: not in tools/list`);
    continue;
  }
  const r = await mcp(accessToken, { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: c.tool, arguments: c.args } }, sid);
  const res = r.msg?.result;
  if (r.msg?.error || res?.isError) {
    fail(`call ${c.tool} → ${JSON.stringify(r.msg?.error ?? res?.content).slice(0, 250)}`);
    continue;
  }
  if (tool.outputSchema && res?.structuredContent) {
    const v = new Validator(tool.outputSchema, "2020-12", false).validate(res.structuredContent);
    check(v.valid, `call ${c.tool} → structuredContent ${v.valid ? "validates" : "INVALID " + JSON.stringify(v.errors.slice(0, 2))}`);
  } else {
    check(Boolean(res), `call ${c.tool} → ${JSON.stringify(res?.content ?? res).slice(0, 120)}`);
  }
}

// Session must not be usable without its token
const noTok = await mcp(null, { jsonrpc: "2.0", id: 90, method: "tools/list", params: {} }, sid);
check(noTok.status === 401, `own session without a token → ${noTok.status} (want 401)`);

// --- 5. cross sign-in session binding --------------------------------------
if (cross) {
  const f = join(stateDir, `${cross}.json`);
  if (!existsSync(f)) fail(`--cross ${cross}: no saved sign-in (run once with --save ${cross})`);
  else {
    const other = JSON.parse(readFileSync(f, "utf8"));
    if (other.mcpUrl !== mcpUrl) fail(`--cross ${cross} was saved for ${other.mcpUrl}`);
    else {
      const r = await mcp(accessToken, { jsonrpc: "2.0", id: 91, method: "tools/list", params: {} }, other.sessionId);
      check(r.status >= 400 || Boolean(r.msg?.error), `other sign-in's session with THIS token is refused → ${r.status} ${JSON.stringify(r.msg?.error ?? "").slice(0, 120)}`);
      const own = await mcp(other.accessToken, { jsonrpc: "2.0", id: 92, method: "tools/list", params: {} }, other.sessionId);
      console.log(`       (saved sign-in '${cross}' on its own session → ${own.status}${own.status === 401 ? ", token expired/revoked" : ""})`);
    }
  }
}
if (save) {
  const f = join(stateDir, `${save}.json`);
  writeFileSync(f, JSON.stringify({ mcpUrl, accessToken, sessionId: sid, savedAt: new Date().toISOString() }));
  chmodSync(f, 0o600);
  console.log(`       saved sign-in as '${save}'`);
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
