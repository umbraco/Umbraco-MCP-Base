#!/usr/bin/env node
/**
 * Direct checks of SDK behaviour that the consumers don't reach on their own,
 * run with the SDK installed in a consumer worktree, against a real Umbraco:
 *
 *   - token cache: concurrent calls on a cold cache share one token request;
 *     a 401 with a Bearer challenge gets one fresh token and one resend; a
 *     401 without a challenge (a permission check) is returned as is
 *   - resolveMediaTypeId: built-in aliases resolve to their ids, results are
 *     cached, unknown aliases give undefined
 *
 *   node scripts/smoke/sdk-check.mjs <consumer-dir> <umbraco-base-url>
 *
 * Uses UMBRACO_CLIENT_ID / UMBRACO_CLIENT_SECRET (default: the demo sites'
 * API user). Needs NODE_TLS_REJECT_UNAUTHORIZED=0 for a local self-signed site.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [devDir, baseUrl] = process.argv.slice(2);
// The SDK is ESM-only (an "import" export condition), so import its entry file.
const pkgDir = join(devDir, "node_modules/@umbraco-cms/mcp-server-sdk");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entry = pkg.exports?.["."]?.import?.default ?? pkg.exports?.["."]?.import ?? pkg.exports?.["."]?.default ?? "dist/index.js";
console.log(`SDK ${pkg.version} (${entry})`);
const sdk = await import(pathToFileURL(join(pkgDir, typeof entry === "string" ? entry : "dist/index.js")).href);
const { initializeUmbracoFetch, UmbracoManagementClient, resolveMediaTypeId, clearMediaTypeIdCache, MEDIA_TYPE_ALIASES, STANDARD_MEDIA_TYPES } = sdk;

let fails = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fails++; };

// Count what goes over the wire; optionally answer one API call with a 401.
const realFetch = globalThis.fetch;
let tokenRequests = 0;
let apiRequests = 0;
let inject401 = 0;
let challenge = true;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (/\/security\/back-office\/token/.test(url)) tokenRequests++;
  else if (/\/management\/api\//.test(url)) {
    apiRequests++;
    if (inject401 > 0) {
      inject401--;
      // What Umbraco's token validation sends when it refuses the token itself.
      const headers = { "content-type": "application/json" };
      if (challenge) headers["www-authenticate"] = 'Bearer error="invalid_token", error_description="The specified token is invalid."';
      return new Response(JSON.stringify({ title: "Unauthorized", status: 401 }), { status: 401, headers });
    }
  }
  return realFetch(input, init);
};

// What does the real site send for a refused token? (The SDK only resends on a Bearer challenge.)
const real = await realFetch(`${baseUrl}/umbraco/management/api/v1/server/information`, { headers: { authorization: "Bearer not-a-real-token" } });
console.log(`real Umbraco, bad token → ${real.status}, WWW-Authenticate: ${real.headers.get("www-authenticate") ?? "(none)"}`);

initializeUmbracoFetch({
  baseUrl,
  clientId: process.env.UMBRACO_CLIENT_ID ?? "umbraco-back-office-mcp",
  clientSecret: process.env.UMBRACO_CLIENT_SECRET ?? "1234567890",
});
const serverInfo = () => UmbracoManagementClient({ url: "/umbraco/management/api/v1/server/information", method: "GET" });

console.log("#418 token cache");
await Promise.all(Array.from({ length: 10 }, serverInfo));
check(tokenRequests === 1, `10 concurrent calls on a cold cache → ${tokenRequests} token request(s) (want 1, single-flight)`);
await serverInfo();
check(tokenRequests === 1, `a later call reuses the cached token → ${tokenRequests} token request(s) total`);
const before = { tokens: tokenRequests, api: apiRequests };
inject401 = 1;
let retried;
try { retried = await serverInfo(); } catch (e) { retried = e; }
check(!(retried instanceof Error), `call answered once with 401 still succeeds${retried instanceof Error ? ": " + retried.message : ""}`);
check(tokenRequests === before.tokens + 1, `… after fetching a fresh token (${tokenRequests - before.tokens} new token request)`);
check(apiRequests === before.api + 2, `… and retrying exactly once (${apiRequests - before.api} API requests)`);
inject401 = 2;
let twice;
try { twice = await serverInfo(); } catch (e) { twice = e; }
check(twice instanceof Error, `two 401s in a row → error surfaced instead of looping${twice instanceof Error ? " (" + twice.message.slice(0, 60) + ")" : ""}`);
challenge = false;
inject401 = 1;
const t0 = tokenRequests, a0 = apiRequests;
let perm;
try { perm = await serverInfo(); } catch (e) { perm = e; }
check(perm instanceof Error && tokenRequests === t0 && apiRequests === a0 + 1, `401 without a Bearer challenge (a permission check) → returned as is, no new token, no resend`);
inject401 = 0;
challenge = true;

console.log("#458 resolveMediaTypeId");
clearMediaTypeIdCache();
for (const alias of ["Image", "Folder", "File"]) {
  const key = MEDIA_TYPE_ALIASES?.[alias] ?? alias;
  const id = await resolveMediaTypeId(key);
  const expected = STANDARD_MEDIA_TYPES?.[key] ?? STANDARD_MEDIA_TYPES?.[alias];
  check(Boolean(id) && (!expected || id === expected), `${alias} (${key}) → ${id}${expected ? (id === expected ? " = built-in id" : ` ≠ built-in ${expected}`) : ""}`);
}
const apiBeforeCache = apiRequests;
await resolveMediaTypeId(MEDIA_TYPE_ALIASES?.Image ?? "Image");
check(apiRequests === apiBeforeCache, `second lookup of the same alias is cached (${apiRequests - apiBeforeCache} API requests)`);
const missing = await resolveMediaTypeId("smokeNoSuchMediaTypeAlias");
check(missing === undefined, `unknown alias → ${missing} (want undefined)`);

console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
