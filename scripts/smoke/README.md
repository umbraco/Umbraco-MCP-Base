# Pre-release consumer smoke

Run this before cutting a release. It installs the packages from `dev` into the real consumers, [`umbraco-mcp-dev-cms`](https://github.com/umbraco/Umbraco-CMS-MCP-Dev) and `umbraco-mcp-editor-cms`, and into a freshly scaffolded project. It then runs the consumers' own test suites and checks the hosted Workers on Umbraco Cloud.

It exists because the consumers' suites have caught problems the SDK's own tests could not. Past bumps needed consumer patches after release: OTel spans silently dropped, debug logs corrupting stdio, output-schema mismatches, missing `--call` version checks.

What it does not do:

- It never pushes. Pushing `release/*` publishes to MyGet, and that version can't be republished.
- It never touches your checkouts or your everyday demo site. Every repo is a detached worktree under the smoke root, and the Umbraco sites run on side ports with their own databases.

## Prerequisites

- **Node:** within the SDK's `engines` range. The script refuses to run on anything older.
- **`npm ci` in this repo.** The checkers load `@cfworker/json-schema` from its `node_modules`.
- **.NET 10, and SQL Server.** The local `sql` Docker container works. The connection string is taken from `TEST_SQL_CONNECTION_STRING` in this repo's `.env`, or from `SMOKE_SQL_CONNECTION_STRING`. Without it, the sites fall back to SQLite, which can't handle the full suites (`database table is locked` errors, token 500s, hook timeouts).
- **Local checkouts** of both consumers. Defaults are `~/Projects/umbraco-mcp-dev-cms` and `~/Projects/umbraco-mcp-editor-cms`; override with `DEV_CMS_REPO` / `EDITOR_CMS_REPO`. The worktrees are cut from `origin/dev` (override with `CONSUMER_REF`).
- **For the hosted part:** `npx wrangler login`, plus a browser where you can sign in to the Cloud test site.

## 1. Packages and consumers

```bash
V=1.0.0-beta.48            # the version you're about to release
npm run smoke -- pack      --version $V   # build + npm pack; checks no file: deps, bins present, versions
npm run smoke -- consumers --version $V   # dev-cms + editor-cms on the tarballs, one SDK copy each
npm run smoke -- scaffold  --version $V   # create-umbraco-mcp-server → build → --list-tools
```

editor-cms chains to dev-cms. The `consumers` stage builds dev-cms on the new SDK, packs it, and installs that tarball into editor-cms with `overrides`. The combination under test is therefore the one that will ship, with a single SDK copy. Two copies would give the chained servers separate singletons.

Everything lands in `~/Projects/mcp-smoke/<version>-smoke.<n>/`. To smoke a fix, commit it and run `--n 2`. This produces fresh tarball versions, so npm's cache can't hand back the old ones.

## 2. Umbraco sites

```bash
npm run smoke -- umbraco --version $V
```

This bootstraps each consumer's own demo site. That site registers the consumer's hosted OAuth client and seeds the content its tests expect:

| Consumer | Ports (https / http) | Database |
|---|---|---|
| dev-cms | 44491 / 56572 | `umbraco-mcp-smoke-dev-cms` |
| editor-cms | 44591 / 56672 | `umbraco-mcp-smoke-editor-cms` |

The stage prints the commands that start each site and create its API user. editor-cms also gets a publish-root-content step. Umbraco's unattended install creates the database itself.

## 3. Gate

```bash
npm run smoke -- gate --version $V
```

The gate runs each consumer's unit/integration suite and hosted e2e suite against its smoke site. Evals run too when `ANTHROPIC_API_KEY` or `SMOKE_EVALS=1` is set. Logs are written to the smoke root as `gate-*.log`.

`PASS*` means the only failures were snapshots that differ by the smoke site's port. For example, dev-cms's media-URL snapshots record `localhost:44391`. That isn't an SDK change.

When something fails:

```bash
npm run smoke -- baseline     --version $V   # unmodified consumers on the SDK their lockfile pins
npm run smoke -- rerun-failed --version $V   # the failing files on smoke AND baseline, same site
```

If a file also fails on the baseline, the cause is the environment or the test, not the release. Rerun a file that fails on only one side a couple of times before believing it.

## 4. Stdio and CLI spot checks

```bash
S=~/Projects/mcp-smoke/$V-smoke.1
npm run smoke:stdio -- $S/dev-cms --min-tools 400 \
  --env NODE_TLS_REJECT_UNAUTHORIZED=0 --env UMBRACO_BASE_URL=https://localhost:44491 \
  --call get-server-information '{}' --call get-document-root '{}' \
  --expect-error get-document-by-id '{"id":"../../server/status"}'
npm run smoke:stdio -- $S/editor-cms --env NODE_TLS_REJECT_UNAUTHORIZED=0 \
  --env UMBRACO_BASE_URL=https://localhost:44591 --call list-document-types '{}'
```

`stdio-check` flags any stdout line that isn't JSON-RPC, and it validates every `structuredContent` against the tool's `outputSchema`. Add `--env UMBRACO_DRY_RUN=true` to check dry-run, and `--print-tools` to list tool names.

The CLI has to be driven by hand: `--list-tools`, `--describe-tool`, `--call <tool> --call-args '<json>'`, `--umbraco-readonly`, and `UMBRACO_EXPECTED_MAJOR=<other>` for the version-mismatch warning. `NODE_TLS_REJECT_UNAUTHORIZED=0` must be in the process environment, because a `.env` file doesn't apply it.

## 5. Hosted on Umbraco Cloud

```bash
npm run smoke -- hosted --version $V
```

This deploys `mcp-smoke-dev-cms` and `mcp-smoke-editor-cms` to the Cloudflare account `wrangler` is logged into. Each Worker gets its own KV namespace and `COOKIE_ENCRYPTION_KEY`, configured like the production Workers (`umbraco-cloud-hosted-mcp` terraform). The Worker names are fixed, so their URLs stay the same between releases.

**One-off per Cloud test site.** The site's OAuth clients only accept the official `*.mcp.umbraco.ai` callbacks, so someone with access to the site must allow the Worker callbacks the stage prints, for example:

```
umbraco-cms-developer-mcp-hosted   https://mcp-smoke-dev-cms.<subdomain>.workers.dev/callback/mcp-test-v18
umbraco-cms-editor-mcp-hosted      https://mcp-smoke-editor-cms.<subdomain>.workers.dev/callback/mcp-test-v18
```

Until that's done, sign-in fails with `ID2043` (invalid redirect URI).

Then run the checks for each Worker:

```bash
D=https://mcp-smoke-dev-cms.<subdomain>.workers.dev/at/mcp-test-v18.euwest01/mcp
npm run smoke:hosted -- $D --min-tools 50 --save a --call get-server-information '{}'
# open the printed authorize URL, approve consent, sign in to Umbraco
npm run smoke:hosted -- $D --cross a --save b --call get-user-current '{}'
# second sign-in: tick "Read-only mode" on consent; expect fewer tools,
# and sign-in a's MCP session must refuse b's token (session binding)
```

**The sign-in is always done by a person.** It's a real Umbraco ID login.

To check re-auth when the Umbraco session is gone, delete that sign-in's `umbraco_token_v2:*` entry from the Worker's KV namespace (`wrangler kv key list/delete --remote`). The next MCP call must return `401 invalid_token` "Umbraco sign-in expired".

Tokens are kept in `~/Projects/mcp-smoke/.hosted-state/` (mode 600) and are never printed. Delete the Workers and their KV with `npm run smoke -- hosted-teardown`.

## Recording the result

Paste the gate summary, the stdio and hosted check results, and anything that only fails on one side into the release PR. List the changes consumers need for the bump; those become follow-up PRs on the consumers.
