#!/usr/bin/env node
/**
 * Pre-release smoke test of this repo's packages against the real consumers
 * (umbraco-mcp-dev-cms, umbraco-mcp-editor-cms) and a fresh scaffold.
 *
 * Everything is installed from `npm pack` tarballs — never `npm link` — so
 * the packaging itself (prepack `file:` rewrite, `files`, bin shims) is under
 * test, and editor-cms gets ONE copy of the SDK shared with the mcp-dev it
 * chains to. Nothing is pushed and the real checkouts are never touched:
 * every repo is a detached git worktree under the smoke root.
 *
 *   node scripts/smoke/smoke-consumers.mjs <stage> [--version <x.y.z-beta.N>] [--ref <git-ref>] [--n <N>]
 *
 * Stages (run in order; each is re-runnable):
 *   pack       worktree this repo at --ref (default HEAD), stamp
 *              <version>-smoke.<N>, build, npm pack, verify the tarballs
 *   consumers  worktree dev-cms + editor-cms (origin/dev), install the
 *              tarballs; build + pack dev-cms and install THAT into editor-cms
 *   scaffold   fresh project from the create-mcp-server tarball
 *   umbraco    bootstrap each consumer's own demo site on side ports
 *              (dev 44491/56572, editor 44591/56672), on SQL Server, and
 *              print the start / API-user / seed commands
 *   gate       run each consumer's own suites against those sites; logs in
 *              the smoke root (gate-*.log)
 *   baseline   unmodified consumer worktrees on their pinned SDK
 *   rerun-failed  rerun the gate's failing files on smoke AND baseline
 *   hosted     deploy mcp-smoke-dev-cms / mcp-smoke-editor-cms Workers
 *              (Cloud site routing) to the logged-in wrangler account
 *   hosted-teardown  delete those Workers and their KV namespaces
 *   all        pack → consumers → scaffold → umbraco
 *
 * See scripts/smoke/README.md for the full walkthrough.
 *
 * Env:
 *   SMOKE_ROOT       default ~/Projects/mcp-smoke/<version>-smoke.<N>
 *   DEV_CMS_REPO     default ~/Projects/umbraco-mcp-dev-cms
 *   EDITOR_CMS_REPO  default ~/Projects/umbraco-mcp-editor-cms
 *   CONSUMER_REF     default origin/dev
 *   SMOKE_SQL_CONNECTION_STRING  default TEST_SQL_CONNECTION_STRING (env or
 *                    this repo's .env); SMOKE_SQLITE=1 forces SQLite
 *   SMOKE_{DEV,EDITOR}_{HTTPS,HTTP}_PORT  side-port overrides
 *   SMOKE_CLOUD_SITE default mcp-test-v18.euwest01
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baseRepo = resolve(here, "../..");

const args = process.argv.slice(2);
const stage = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const ref = opt("ref", "HEAD");
const n = opt("n", "1");
const consumerRef = process.env.CONSUMER_REF ?? "origin/dev";
const devRepo = process.env.DEV_CMS_REPO ?? join(homedir(), "Projects/umbraco-mcp-dev-cms");
const editorRepo = process.env.EDITOR_CMS_REPO ?? join(homedir(), "Projects/umbraco-mcp-editor-cms");

const PACKAGES = [
  { dir: "packages/mcp-server-sdk", name: "@umbraco-cms/mcp-server-sdk" },
  { dir: "packages/hosted-mcp", name: "@umbraco-cms/mcp-hosted" },
  { dir: "packages/create-mcp-server", name: "@umbraco-cms/create-umbraco-mcp-server" },
];

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

const baseVersion = execSync(`git -C ${baseRepo} show ${ref}:package.json`, { encoding: "utf8" });
const releaseVersion = JSON.parse(baseVersion).version;
// --version lets you smoke a release before its version-bump commit exists.
const smokeVersion = `${opt("version", releaseVersion)}-smoke.${n}`;
const root = process.env.SMOKE_ROOT ?? join(homedir(), "Projects/mcp-smoke", smokeVersion);
const dirs = {
  base: join(root, "base"),
  tarballs: join(root, "tarballs"),
  dev: join(root, "dev-cms"),
  editor: join(root, "editor-cms"),
  fresh: join(root, "fresh"),
};

function sh(cmd, cwd, { allowFail = false, quiet = false } = {}) {
  console.log(`\n$ (${cwd.replace(root, "<smoke>")}) ${cmd}`);
  try {
    return execSync(cmd, { cwd, stdio: quiet ? "pipe" : "inherit", encoding: "utf8", env: process.env });
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

function checkNode() {
  // Mirror the SDK's own engines range so a too-old Node fails here, loudly,
  // instead of half-way through a consumer install.
  const engines = readJson(join(baseRepo, "packages/mcp-server-sdk/package.json")).engines?.node;
  const [maj, min, pat] = process.versions.node.split(".").map(Number);
  const ok =
    (maj === 22 && (min > 23 || (min === 23 && pat >= 4))) ||
    (maj === 24 && (min > 22 || (min === 22 && pat >= 1))) ||
    (maj === 26 && (min > 12 || (min === 12 && pat >= 1))) ||
    maj > 26;
  if (!ok) {
    console.error(`Node ${process.versions.node} does not satisfy the SDK's engines (${engines}). Use e.g. \`nvm use 22\`.`);
    process.exit(1);
  }
}

function worktree(repo, dest, at) {
  if (existsSync(dest)) {
    console.log(`reusing worktree ${dest}`);
    return;
  }
  sh(`git fetch -q origin`, repo, { allowFail: true });
  sh(`git worktree add --detach ${dest} ${at}`, repo);
}

function tarball(name) {
  const prefix = name.replace("@", "").replace("/", "-");
  const hit = readdirSync(dirs.tarballs).find((f) => f.startsWith(`${prefix}-${smokeVersion}`) && f.endsWith(".tgz"));
  if (!hit) throw new Error(`no tarball for ${name}@${smokeVersion} in ${dirs.tarballs} — run the pack stage`);
  return join(dirs.tarballs, hit);
}

// ---------------------------------------------------------------------------

function pack() {
  worktree(baseRepo, dirs.base, ref);
  for (const p of PACKAGES) {
    const pj = join(dirs.base, p.dir, "package.json");
    const json = readJson(pj);
    json.version = smokeVersion;
    writeJson(pj, json);
  }
  sh(`npm ci --no-audit --no-fund`, dirs.base);
  sh(`npm run build:all`, dirs.base);

  rmSync(dirs.tarballs, { recursive: true, force: true });
  mkdirSync(dirs.tarballs, { recursive: true });
  for (const p of PACKAGES) sh(`npm pack --pack-destination ${dirs.tarballs}`, join(dirs.base, p.dir));

  // Packaging checks: what npm publish would actually ship.
  const problems = [];
  for (const p of PACKAGES) {
    const tgz = tarball(p.name);
    const manifest = JSON.parse(execSync(`tar -xOzf ${tgz} package/package.json`, { encoding: "utf8" }));
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
        if (String(range).startsWith("file:")) problems.push(`${p.name}: ${field}.${dep} is "${range}"`);
      }
    }
    if (manifest.version !== smokeVersion) problems.push(`${p.name}: version ${manifest.version} != ${smokeVersion}`);
    const files = execSync(`tar -tzf ${tgz}`, { encoding: "utf8" });
    for (const bin of Object.values(typeof manifest.bin === "string" ? { x: manifest.bin } : manifest.bin ?? {})) {
      if (!files.includes(`package/${bin.replace(/^\.\//, "")}`)) problems.push(`${p.name}: bin ${bin} missing from tarball`);
    }
  }
  if (problems.length) {
    console.error("\nPACKAGING PROBLEMS:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log(`\npack OK → ${dirs.tarballs}`);
}

/** Point a consumer at the smoke tarballs, forcing every nested copy onto them too. */
function installTarballs(dir, extra = {}) {
  const pj = join(dir, "package.json");
  const json = readJson(pj);
  const sdk = `file:${tarball("@umbraco-cms/mcp-server-sdk")}`;
  const hosted = `file:${tarball("@umbraco-cms/mcp-hosted")}`;
  const set = { "@umbraco-cms/mcp-server-sdk": sdk, "@umbraco-cms/mcp-hosted": hosted, ...extra };
  for (const [dep, spec] of Object.entries(set)) {
    for (const field of ["dependencies", "devDependencies"]) {
      if (json[field]?.[dep]) json[field][dep] = spec;
    }
  }
  // overrides: a top-level override must match the direct dep spec exactly,
  // so use the `$dep` reference form.
  json.overrides = { ...(json.overrides ?? {}) };
  for (const dep of Object.keys(set)) json.overrides[dep] = `$${dep}`;
  writeJson(pj, json);
  sh(`npm install --no-audit --no-fund`, dir);
  // Exactly one copy of each package, and it's ours.
  for (const dep of Object.keys(set)) {
    const out = sh(`npm ls ${dep} --all --parseable --long`, dir, { quiet: true, allowFail: true }) ?? "";
    const versions = new Set(out.trim().split("\n").filter(Boolean).map((l) => l.split(":")[1]));
    console.log(`  ${dep}: ${[...versions].join(", ") || "(not installed)"}`);
    if (versions.size > 1) throw new Error(`${dir}: ${versions.size} copies of ${dep} — chained servers would get separate SDK singletons`);
  }
  const tree = sh(`npm ls @umbraco-cms/mcp-server-sdk --all`, dir, { quiet: true, allowFail: true }) ?? "";
  if (/invalid/.test(tree)) {
    console.error(tree);
    throw new Error(`${dir}: invalid @umbraco-cms/mcp-server-sdk resolution`);
  }
}

function consumers() {
  worktree(devRepo, dirs.dev, consumerRef);
  worktree(editorRepo, dirs.editor, consumerRef);
  // Untracked local config the worktrees don't get from git.
  for (const [repo, dest] of [[devRepo, dirs.dev], [editorRepo, dirs.editor]]) {
    for (const f of [".env", ".dev.vars"]) {
      if (existsSync(join(repo, f)) && !existsSync(join(dest, f))) {
        writeFileSync(join(dest, f), readFileSync(join(repo, f)));
        console.log(`copied ${f} → ${dest}`);
      }
    }
  }

  // dev-cms on the smoke SDK, then pack it so editor-cms chains to the
  // upgraded mcp-dev — the combination that ships.
  installTarballs(dirs.dev);
  sh(`npm run build`, dirs.dev);
  const devVersion = readJson(join(dirs.dev, "package.json")).version;
  for (const f of readdirSync(dirs.tarballs)) if (f.startsWith("umbraco-cms-mcp-dev-")) rmSync(join(dirs.tarballs, f));
  sh(`npm pack --pack-destination ${dirs.tarballs} --ignore-scripts`, dirs.dev);
  const devTgz = join(dirs.tarballs, readdirSync(dirs.tarballs).find((f) => f.startsWith(`umbraco-cms-mcp-dev-${devVersion}`)));

  installTarballs(dirs.editor, { "@umbraco-cms/mcp-dev": `file:${devTgz}` });
  sh(`npm run build`, dirs.editor);
  console.log(`\nconsumers OK → ${dirs.dev}, ${dirs.editor}`);
}

function scaffold() {
  rmSync(dirs.fresh, { recursive: true, force: true });
  mkdirSync(dirs.fresh, { recursive: true });
  const cli = tarball("@umbraco-cms/create-umbraco-mcp-server");
  sh(`npm exec --yes --package=${cli} -- create-umbraco-mcp-server smoke-mcp`, dirs.fresh);
  const project = join(dirs.fresh, "smoke-mcp");
  installTarballs(project);
  sh(`npm run build`, project);
  sh(`node dist/index.js --list-tools`, project);
  console.log(`\nscaffold OK → ${project}`);
}

// Each consumer runs against its OWN demo site (it registers that repo's
// hosted OAuth client and seeds the content its tests expect), on side ports
// so a developer's everyday demo site on the default ports is left alone.
const SITES = {
  dev: {
    https: Number(process.env.SMOKE_DEV_HTTPS_PORT ?? 44491),
    http: Number(process.env.SMOKE_DEV_HTTP_PORT ?? 56572),
  },
  editor: {
    https: Number(process.env.SMOKE_EDITOR_HTTPS_PORT ?? 44591),
    http: Number(process.env.SMOKE_EDITOR_HTTP_PORT ?? 56672),
  },
};
const siteEnv = (s) =>
  `UMBRACO_BASE_URL=https://localhost:${s.https} UMBRACO_SERVER_URL=http://localhost:${s.http} NODE_TLS_REJECT_UNAUTHORIZED=0`;
// The demo sites' unattended-install admin (from each consumer's
// demo-site-template/appsettings.Development.json) — a local test login only.
// editor-cms's hosted e2e defaults to a different one, so pass it explicitly.
const DEMO_ADMIN = "UMBRACO_ADMIN_EMAIL=admin@admin.com UMBRACO_ADMIN_PASSWORD=1234567890";

/**
 * Make the consumers' hosted-e2e harness take the Umbraco URLs from the
 * environment (editor-cms already does; dev-cms hard-codes 44391/56472).
 * Worktree-only edit — upstream should get the same env fallback.
 */
function patchPorts(devDir = dirs.dev) {
  const f = join(devDir, "tests/cms-hosted-e2e/helpers/worker-setup.ts");
  if (!existsSync(f)) return;
  const src = readFileSync(f, "utf8");
  const patched = src
    .replace(/UMBRACO_BASE_URL: "(https:\/\/localhost:\d+)"/, 'UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL ?? "$1"')
    .replace(/UMBRACO_SERVER_URL: "(http:\/\/localhost:\d+)"/, 'UMBRACO_SERVER_URL: process.env.UMBRACO_SERVER_URL ?? "$1"');
  if (patched !== src) {
    writeFileSync(f, patched);
    console.log(`patched ${f} to read UMBRACO_BASE_URL / UMBRACO_SERVER_URL from env`);
  }
}

/**
 * SQL Server connection string for the smoke sites. SQLite can't take the
 * consumers' full suites (`database table is locked` → token 500s and hook
 * timeouts), so SQL Server is the default whenever one is configured:
 * SMOKE_SQL_CONNECTION_STRING, else TEST_SQL_CONNECTION_STRING from this
 * repo's .env. Each consumer gets its OWN database (`umbraco-mcp-smoke-<key>-cms`)
 * so a developer's everyday demo database is never touched.
 */
function sqlConnectionFor(key) {
  let cs = process.env.SMOKE_SQL_CONNECTION_STRING ?? process.env.TEST_SQL_CONNECTION_STRING;
  const envFile = join(baseRepo, ".env");
  if (!cs && existsSync(envFile)) {
    cs = readFileSync(envFile, "utf8").match(/^TEST_SQL_CONNECTION_STRING=(.*)$/m)?.[1]?.trim();
  }
  if (!cs) return null;
  const db = `umbraco-mcp-smoke-${key}-cms`;
  return /Database=[^;]*/i.test(cs) ? cs.replace(/Database=[^;]*/i, `Database=${db}`) : `${cs.replace(/;?$/, ";")}Database=${db}`;
}

/** Bootstrap each consumer's demo site (SQL Server if configured, else SQLite) and print how to start it. */
function umbraco() {
  for (const [key, dir] of [["dev", dirs.dev], ["editor", dirs.editor]]) {
    const cs = process.env.SMOKE_SQLITE ? null : sqlConnectionFor(key);
    sh(`bash scripts/bootstrap-demo-site.sh${cs ? "" : " --sqlite"}`, dir, { allowFail: true });
    if (cs) {
      // Overwrites a SQLite appsettings.local.json from an earlier run.
      writeJson(join(dir, "demo-site/appsettings.local.json"), {
        ConnectionStrings: { umbracoDbDSN: cs, umbracoDbDSN_ProviderName: "Microsoft.Data.SqlClient" },
      });
      console.log(`${key}: SQL Server database ${cs.match(/Database=([^;]*)/i)[1]}`);
    } else {
      console.log(`${key}: SQLite (no SQL Server connection configured) — expect lock timeouts under the full suite`);
    }
    const s = SITES[key];
    const seed =
      key === "editor"
        ? ` && node scripts/publish-root-content.mjs http://localhost:${s.http} admin@admin.com 1234567890`
        : "";
    console.log(
      `\nstart ${key} (leave running):\n  (cd ${dir} && ASPNETCORE_ENVIRONMENT=Development dotnet run --project demo-site --no-launch-profile -- --urls "https://localhost:${s.https};http://localhost:${s.http}")` +
        `\nonce https://localhost:${s.https}/umbraco/management/api/v1/server/status answers 200:` +
        `\n  (cd ${dir} && node scripts/create-api-user.mjs http://localhost:${s.http} admin@admin.com 1234567890${seed})`,
    );
  }
  patchPorts();
}

/**
 * Unmodified consumer worktrees (whatever SDK their lockfile pins), so a gate
 * failure can be rerun against the same Umbraco site to tell an SDK
 * regression from an environment problem:
 *   node smoke-consumers.mjs baseline
 *   node smoke-consumers.mjs rerun-failed
 */
function baseline() {
  for (const [repo, key] of [[devRepo, "dev"], [editorRepo, "editor"]]) {
    const dest = `${dirs[key]}-baseline`;
    worktree(repo, dest, consumerRef);
    for (const f of [".env", ".dev.vars"]) {
      const src = join(dirs[key], f);
      if (existsSync(src)) writeFileSync(join(dest, f), readFileSync(src));
    }
    sh(`npm ci --no-audit --no-fund`, dest);
    sh(`npm run build`, dest);
    const sdk = readJson(join(dest, "node_modules/@umbraco-cms/mcp-server-sdk/package.json")).version;
    console.log(`baseline ${key}: @umbraco-cms/mcp-server-sdk ${sdk}`);
  }
  patchPorts(`${dirs.dev}-baseline`);
}

/** Rerun the files that failed in the gate, on smoke AND baseline, side by side. */
function rerunFailed() {
  const rows = [];
  for (const [key, log] of [["dev", "gate-dev-unit.log"], ["editor", "gate-editor-unit.log"]]) {
    const p = join(root, log);
    if (!existsSync(p)) continue;
    const files = [...new Set(readFileSync(p, "utf8").split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.replace(/^FAIL\s+(\S+\s+)?/, "").replace(/\s+\(.*$/, "")))].filter((f) => f.includes("/"));
    if (!files.length) continue;
    const env = siteEnv(SITES[key]);
    for (const [label, dir] of [["smoke", dirs[key]], ["baseline", `${dirs[key]}-baseline`]]) {
      const ok = sh(`${env} node --experimental-vm-modules node_modules/jest/bin/jest.js --ci --runInBand --forceExit ${files.join(" ")}`, dir, { allowFail: true }) !== null;
      rows.push(`${key.padEnd(7)} ${label.padEnd(9)} ${ok ? "PASS" : "FAIL"} (${files.length} files)`);
    }
  }
  console.log("\n" + rows.join("\n"));
}

/**
 * True when every failure in a jest log is a snapshot whose diff differs only
 * by a `localhost:<port>` — i.e. the snapshot was recorded against the
 * consumer's default demo-site port and the smoke site runs on a side port.
 */
function portOnlySnapshotFailures(log) {
  const failedTests = Number(log.match(/^Tests:.*?(\d+) failed/m)?.[1] ?? 0);
  const failedSnaps = Number(log.match(/^Snapshots:.*?(\d+) failed/m)?.[1] ?? 0);
  if (!failedTests || failedTests !== failedSnaps) return false;
  const norm = (l) => l.replace(/^\s*[-+]\s?/, "").replace(/localhost:\d+/g, "localhost:PORT").trim();
  const minus = [];
  const plus = [];
  for (const l of log.split("\n")) {
    if (/^\s+- Snapshot|^\s+\+ Received/.test(l)) continue;
    if (/^\s{4,}- /.test(l)) minus.push(norm(l));
    else if (/^\s{4,}\+ /.test(l)) plus.push(norm(l));
  }
  return minus.length > 0 && JSON.stringify(minus.sort()) === JSON.stringify(plus.sort());
}

function gate() {
  patchPorts();
  const results = [];
  const run = (label, cmd, cwd, logName) => {
    const logFile = join(root, logName);
    const ok = sh(`${cmd} > ${logFile} 2>&1`, cwd, { allowFail: true }) !== null;
    const log = readFileSync(logFile, "utf8");
    const summary = (log.match(/^Tests:.*$/m)?.[0] ?? log.match(/^\s*\d+ (passed|failed).*$/m)?.[0] ?? "").trim();
    let status = ok ? "PASS" : "FAIL";
    if (!ok && portOnlySnapshotFailures(log)) status = "PASS*";
    results.push(`${status.padEnd(6)} ${label.padEnd(28)} ${summary}  (${logName})`);
  };
  const dev = siteEnv(SITES.dev);
  const ed = `${siteEnv(SITES.editor)} ${DEMO_ADMIN}`;
  run("dev-cms unit/integration", `${dev} npm test -- --ci`, dirs.dev, "gate-dev-unit.log");
  run("dev-cms hosted e2e", `${dev} HEADLESS=true SLOW_MO=0 npm run test:e2e`, dirs.dev, "gate-dev-e2e.log");
  run("editor-cms unit/integration", `${ed} npm test -- --ci`, dirs.editor, "gate-editor-unit.log");
  run("editor-cms hosted e2e", `${ed} HEADLESS=true SLOW_MO=0 npm run test:e2e`, dirs.editor, "gate-editor-e2e.log");
  if (process.env.ANTHROPIC_API_KEY || process.env.SMOKE_EVALS) {
    run("dev-cms evals", `${dev} npm run test:evals`, dirs.dev, "gate-dev-evals.log");
    run("editor-cms evals", `${ed} npm run test:evals`, dirs.editor, "gate-editor-evals.log");
  } else {
    results.push("SKIP   evals (set SMOKE_EVALS=1 or ANTHROPIC_API_KEY)");
  }
  console.log("\n" + results.join("\n"));
  if (results.some((r) => r.startsWith("PASS*"))) {
    console.log("\nPASS* = the only failures are snapshots that differ by the smoke site's port (not an SDK change).");
  }
  if (results.some((r) => r.startsWith("FAIL"))) {
    console.log("\nNext: `baseline` then `rerun-failed` to see whether the same files fail without the smoke SDK.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Deployed Workers (Umbraco Cloud site routing), on YOUR Cloudflare account.
//
// Mirrors the production Worker config in umbraco-cloud-hosted-mcp's
// terraform (UMBRACO_CLOUD_ROUTING_ENABLED=true, an OAUTH_KV namespace, a
// COOKIE_ENCRYPTION_KEY secret). Worker names are fixed — not per-version —
// so the redirect origins registered on the Cloud test site stay valid for
// every future smoke run.

const WORKERS = [
  { key: "dev", name: "mcp-smoke-dev-cms", dir: () => dirs.dev },
  { key: "editor", name: "mcp-smoke-editor-cms", dir: () => dirs.editor },
];

function wrangler(cmd, cwd, opts) {
  return sh(`npx wrangler ${cmd}`, cwd, opts);
}

function ensureKv(title, cwd) {
  const list = JSON.parse(wrangler(`kv namespace list`, cwd, { quiet: true }));
  const hit = list.find((ns) => ns.title === title);
  if (hit) return hit.id;
  const out = wrangler(`kv namespace create ${title}`, cwd, { quiet: true });
  const id = out.match(/id = "([0-9a-f]+)"/)?.[1] ?? out.match(/"id":\s*"([0-9a-f]+)"/)?.[1];
  if (!id) throw new Error(`could not parse KV id from:\n${out}`);
  return id;
}

function hosted() {
  const keyFile = join(homedir(), "Projects/mcp-smoke/.cookie-keys.json");
  const keys = existsSync(keyFile) ? readJson(keyFile) : {};
  const urls = [];
  for (const w of WORKERS) {
    const cwd = w.dir();
    const base = readFileSync(join(cwd, "wrangler.toml"), "utf8");
    const kvId = ensureKv(`${w.name}-oauth`, cwd);
    const toml = base
      .replace(/^name = ".*"$/m, `name = "${w.name}"`)
      .replace(/(\[\[kv_namespaces\]\][^[]*?id = )"[^"]*"/s, `$1"${kvId}"`)
      .replace(/^\[vars\][\s\S]*?(?=^\[|(?![\s\S]))/m, "") +
      `\n[vars]\nUMBRACO_CLOUD_ROUTING_ENABLED = "true"\n\n[observability]\nenabled = true\n`;
    writeFileSync(join(cwd, "wrangler.smoke.toml"), toml);
    const out = wrangler(`deploy -c wrangler.smoke.toml`, cwd, { quiet: true });
    process.stdout.write(out.split("\n").filter((l) => /Uploaded|Deployed|https:\/\/|Current Version/.test(l)).join("\n") + "\n");
    // Stable per Worker so redeploys don't invalidate live sessions.
    keys[w.name] ??= execSync("openssl rand -hex 32", { encoding: "utf8" }).trim();
    execSync(`npx wrangler secret put COOKIE_ENCRYPTION_KEY -c wrangler.smoke.toml`, { cwd, input: keys[w.name], stdio: ["pipe", "ignore", "inherit"] });
    const url = out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
    urls.push(`${w.key.padEnd(7)} ${url ?? "(see deploy output)"}`);
  }
  writeJson(keyFile, keys);
  const site = process.env.SMOKE_CLOUD_SITE ?? "mcp-test-v18.euwest01";
  console.log(`\nhosted OK — MCP endpoints (Cloud site ${site}):`);
  for (const u of urls) {
    const [k, origin] = u.split(/\s+/);
    console.log(`  ${k.padEnd(7)} ${origin}/at/${site}/mcp`);
  }
  const alias = site.split(".")[0];
  console.log(
    `\nOne-off, per Cloud test site: its OAuth clients must accept these redirect URIs` +
      `\n(Umbraco.Mcp.HostedAuth only registers the official *.mcp.umbraco.ai hosts by default):`,
  );
  for (const u of urls) {
    const [k, origin] = u.split(/\s+/);
    const clientId = k === "dev" ? "umbraco-cms-developer-mcp-hosted" : "umbraco-cms-editor-mcp-hosted";
    console.log(`  ${clientId.padEnd(34)} ${origin}/callback/${alias}`);
  }
  console.log(`\nThen, per Worker: node scripts/smoke/hosted-check.mjs <mcp-url> --call <tool> '{}' ...`);
}

function hostedTeardown() {
  for (const w of WORKERS) {
    wrangler(`delete --name ${w.name} --force`, w.dir(), { allowFail: true });
    const list = JSON.parse(wrangler(`kv namespace list`, w.dir(), { quiet: true }));
    const ns = list.find((n) => n.title === `${w.name}-oauth`);
    if (ns) wrangler(`kv namespace delete --namespace-id ${ns.id} --force`, w.dir(), { allowFail: true });
  }
}

// ---------------------------------------------------------------------------

checkNode();
console.log(`smoke ${smokeVersion} (ref ${ref}) → ${root}`);
const stages = {
  pack,
  consumers,
  scaffold,
  umbraco,
  gate,
  baseline,
  "rerun-failed": rerunFailed,
  hosted,
  "hosted-teardown": hostedTeardown,
  all: () => (pack(), consumers(), scaffold(), umbraco()),
};
if (!stages[stage]) {
  console.error(`usage: smoke-consumers.mjs <${Object.keys(stages).join("|")}> [--version <x.y.z-beta.N>] [--ref <ref>] [--n <N>]`);
  process.exit(2);
}
stages[stage]();
