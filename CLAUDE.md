# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monorepo for the Umbraco MCP (Model Context Protocol) Server SDK - infrastructure for building MCP servers that expose Umbraco APIs to AI assistants.

## Monorepo Structure

| Workspace | Description | Published |
|-----------|-------------|-----------|
| `packages/mcp-server-sdk/` | Core npm package `@umbraco-cms/mcp-server-sdk` | Yes |
| `packages/hosted-mcp/` | Hosted MCP on Cloudflare Workers `@umbraco-cms/mcp-hosted` | Yes |
| `packages/create-mcp-server/` | CLI scaffolding tool `@umbraco-cms/create-umbraco-mcp-server` | Yes |
| `template/` | Starter kit for new MCP server projects (copied by create-mcp-server); ships with `.mcp.json` for Claude Code | No |
| `plugins/` | Claude Code plugins for SDK development (building, testing) | No |
| `tests/cli/` | CLI integration tests and LLM eval tests | No |
| `docs/` | CLI reference and planning docs | No |

Each workspace has its own CLAUDE.md with detailed guidance.

## Build Commands

```bash
npm install           # Install all workspace dependencies
npm run build         # Build SDK
npm run test          # Test SDK
```

Workspace-specific commands use `-w` flag: `npm run build -w packages/mcp-server-sdk`

## Test Catalogue

Run all tests before merging. Tests are grouped by what they cover and what infrastructure they need.

### No infrastructure required

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm run test` | SDK unit tests (tool filtering, config, helpers, CLI commands) | ~425 |
| `npm test -w packages/hosted-mcp` | Hosted MCP unit tests (config, auth, consent, server creation) | ~191 |
| `npm test -w packages/create-mcp-server` | Scaffolding CLI unit tests | ~121 |

### Requires `npm run build` + `npm run build -w template`

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm run test:cli` | CLI integration tests — runs built template binary with filtering, introspection, dry-run, input sanitization; plus the target-major stamp CLI (argument handling, exit codes, lazy `--spec`) | ~40 |
| `npm run test:integration` | Hosted MCP Wrangler integration tests | ~20 |
| `npm run test:integration:chained` | Chained hosted MCP integration tests | ~18 |

### Requires `npm run build` + running Umbraco instance (`dotnet run --project tests/umbraco-instance`)

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm run test:e2e` | Hosted MCP Playwright E2E — OAuth flow, tool selection, readOnly filtering via MCP Inspector | ~15 |
| `npm run test:e2e:chained` | Chained MCP Playwright E2E — chained tool discovery, consent screen, filtering | ~12 |

### Requires `npm run build` + `USE_MOCK_API=true`

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm run test:template` | Template tool handler unit tests — MSW intercepts API calls, no Umbraco needed | ~24 |

Note: `USE_MOCK_API=true` enables MSW interception. Without it, tests hit the real Umbraco API (this is the default for scaffolded sites). The `test:template` script sets it automatically.

### Requires `ANTHROPIC_API_KEY` or Claude Code subscription

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm run test:cli:evals` | LLM eval tests — agent uses mcp-cli skill to run and interpret CLI commands | ~21 |

### Requires SQL Server + .NET 10

| Command | What it tests | Tests |
|---------|--------------|-------|
| `TEST_SQL_CONNECTION_STRING="..." npm run test:e2e -w packages/create-mcp-server` | New-instance CLI E2E — scaffold, init's "create new" branch (PSW), Umbraco setup, discover, generate, compile, test | ~19 |
| `TEST_SQL_CONNECTION_STRING="..." npm run test:e2e:existing -w packages/create-mcp-server` | Existing-instance CLI E2E — spawns a copy of `tests/umbraco-instance/` on a random port against a per-test SQL Server DB, runs scaffold + init's "use existing" branch, asserts `.env`, `orval.config.ts`, and a real API call | ~3 |

## SDK Package Exports

| Entry Point | Purpose |
|-------------|---------|
| `@umbraco-cms/mcp-server-sdk` | Main: tool helpers, decorators, types, config loaders, CLI helpers (`handleCliCommands`) |
| `@umbraco-cms/mcp-server-sdk/testing` | Test utilities: setupTestEnvironment, setupMswServer, snapshot helpers |
| `@umbraco-cms/mcp-server-sdk/evals` | LLM eval framework: runScenarioTest, verification helpers |
| `@umbraco-cms/mcp-server-sdk/config` | Configuration loading |
| `@umbraco-cms/mcp-server-sdk/helpers` | API call helpers only |
| `@umbraco-cms/mcp-server-sdk/constants` | Umbraco well-known IDs |

## Core Concepts

**ToolDefinition** - Type-safe tool structure with name, description, input/output schemas, slices, annotations, and handler.

**Tool Collections** - Groups of related tools with metadata (name, displayName, description, dependencies).

**Tool Filtering** - Filter tools by modes (collection groups), slices (operation categories), collections, or individual tool names. Configured via env vars or CLI flags.

**API Call Helpers** - Standardized handlers for GET, DELETE, PUT, POST operations with automatic error handling and ProblemDetails support.

**MCP Chaining** - Proxy tools from other MCP servers via McpClientManager.

## Playwright / E2E Testing

- The test Umbraco instance lives at `tests/umbraco-instance/`
- You MUST start the Umbraco instance before running any Playwright tests: `dotnet run --project tests/umbraco-instance`
- This applies when running tests against any host (this repo, CMS, Forms, etc.) — the instance must always be running first
- When running Playwright tests for the first time in a session, run a single test first to verify the setup is working. If it passes, then run the full suite.
- Stale `workerd` processes can hold ports (8787, 8789 etc.) after interrupted test runs. If tests fail with "Address already in use", kill them: `lsof -i :8787` then `kill -9 <pid>`

## Integration Tests

- Run with `npm run test:integration` and `npm run test:integration:chained`
- Use Wrangler's `unstable_dev()` — do NOT use `unstable_startWorker()` which hangs with OAuthProvider-wrapped Workers
- Require `--runInBand --forceExit` because Wrangler workers don't exit cleanly
- Wrangler migrations must use `new_sqlite_classes`, not `new_classes`, for Durable Objects

## Eval Tests

- Run with `npm run test:evals` (from template or host projects)
- Require `npm run build` first — evals run against `dist/index.js`, not source
- Require `ANTHROPIC_API_KEY` environment variable or a Claude Code subscription

## Pull Request CI Checks

**Always watch CI after creating or pushing to a PR. Be proactive — don't wait to be asked.**

1. Immediately after `gh pr create` or `git push` to a PR branch, run `gh pr checks <pr-number> --watch`
2. If any check fails, inspect the failure: `gh run view <run-id> --log-failed`
3. Fix the root cause, push, and re-watch until CI is green
4. Only report the PR as done once CI is green (or explicitly call out which checks failed and why)

Do not just push a PR and walk away — the CI build includes tests that don't run locally (CLI E2E with SQL Server, Playwright E2E, scaffolding compilation checks). The user should never have to ask "did CI pass?" — you should already be watching.

## Self-Signed Certificates

The local Umbraco instance uses HTTPS with self-signed certs. TLS rejection must be disabled in three places:
- Environment variable: `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Jest setup file: `https.globalAgent.options.rejectUnauthorized = false` (env var alone is insufficient in Jest VM context)
- Playwright config: `ignoreHTTPSErrors: true`

## Releases

All packages are versioned together and published from the `main` branch via Azure Pipelines.

### Branching & merging

The full workflow lives in the **`release-and-branching` skill** (`.claude/skills/`). In short:

- **Never commit directly to `dev` or `main`** (both protected). Do all work on a `feature/…`, `fix/…`, or `chore/…` branch cut from `dev`.
- **Normal PRs → squash-merge into `dev`** (one commit per PR).
- **Releases → merge-commit (not squash) into `main`** via a `release/<version>` branch (see below); the real version-bump commit on `main` is what the tag + `main`→`dev` automation keys off.

### Release process

> Follow the **`release-and-branching` skill** for the workflow (branch, merge style, sync-back). The steps below are the project-specific release mechanics the skill refers to.

1. Create a release branch from `dev`: `release/<version>` (e.g. `release/17.0.0-beta.9`)
2. Bump the version in **all** files (use find-and-replace for the old version string):
   - `package.json` (root)
   - `packages/mcp-server-sdk/package.json`
   - `packages/hosted-mcp/package.json`
   - `packages/create-mcp-server/package.json`
   - `template/package.json`
   - `plugins/umbraco-mcp-skills/package.json`
   - `plugins/umbraco-mcp-skills/.claude-plugin/plugin.json`
   - `.claude-plugin/marketplace.json` (`metadata.version` and each `plugins[].version`)
3. Run `npm install --package-lock-only` to update `package-lock.json`
4. Verify no stale versions: `grep -r "beta.OLD" package.json packages/*/package.json template/package.json plugins/umbraco-mcp-skills/package.json plugins/umbraco-mcp-skills/.claude-plugin/plugin.json .claude-plugin/marketplace.json`
5. Commit, push, and create a PR from the release branch into `main`
6. CI runs all tests including LLM evals and skill E2E (release PRs only)
7. Merge when all checks pass — **use a merge commit, not squash** (preserves the version-bump commit the automation needs). Azure Pipelines then publishes packages to npm
8. GitHub Release tagged `v<version>` is created **automatically** (see below)
9. Merge `main` back into `dev` — **automated** (see below)

### Post-release: tag the release (automated)

When the release merge reaches `main`, **`.github/workflows/release-tag.yml`** creates the `v<version>` git tag and a GitHub Release:

- **Trigger:** any push to `main`. The version is read from `package.json` on the pushed commit, so the tag always matches what landed.
- **Idempotent:** if `v<version>` already exists the run is a no-op, so re-pushes and manual `workflow_dispatch` runs are safe.
- **Notes:** uses the curated changelog from the release PR body (`headRef: release/*`); falls back to GitHub's auto-generated notes if none is found.
- **Prerelease:** flagged automatically when the version has a prerelease suffix (e.g. `-beta.N`).

### Post-release: merge main to dev (automated)

After a release reaches `main`, `dev` is left behind on the version-bump commit. This sync is handled automatically by the **`.github/workflows/sync-main-to-dev.yml`** workflow:

- **Trigger:** any push to `main` (which only happens on a release).
- **Action:** recreates the `chore/merge-main-to-dev` branch from `dev`, merges `main` into it, then opens and immediately merges a PR into `dev`. `dev`'s ruleset requires a PR but 0 approvals and no required checks, so the bot can self-merge.
- **No human step** on the happy path.

**Conflict / manual fallback.** If the merge isn't clean, the workflow fails loudly and you do it by hand:

```bash
git checkout dev && git pull
git checkout -b chore/merge-main-to-dev
git merge origin/main --no-edit
# Resolve any conflicts (take dev's version for code, main's for versions)
git push -u origin chore/merge-main-to-dev
gh pr create --base dev --title "Merge main into dev after <version> release"
```

**The branch name must be exactly `chore/merge-main-to-dev`** — do not add a version suffix. Both the sync workflow and `test.yml` key off this exact name: `test.yml` skips its full CI suite for the PR (the sync only fast-forwards version-bump commits that already passed CI on their way into main). Any other name re-runs the entire suite needlessly.

### Version scheme

- Prerelease: `1.0.0-beta.N` (published with `--tag beta` dist-tag)
- Stable: `1.0.0` (published with `--tag latest` dist-tag)

### Internal cross-package dependencies

Cross-package deps inside the monorepo (`hosted-mcp` → `mcp-server-sdk`, `template` → both) use `file:../<sibling>` references in source. This keeps local development simple — npm workspaces auto-link siblings by name, and you can bump any package's version mid-flight without breaking workspace links.

`npm publish` does **not** rewrite `file:` references in published manifests. Shipping `mcp-hosted` with a literal `"file:../mcp-server-sdk"` corrupts consumer node_modules state (npm resolves the dangling path by linking the nested SDK to the top-level one, which silently prevents creation of bin shims for the SDK package — e.g. `umbraco-mcp-generate-types`).

`mcp-hosted` runs `prepack` / `postpack` scripts (`scripts/rewrite-file-deps.mjs`, `scripts/restore-package-json.mjs`) that rewrite `file:` deps to the sibling's actual version just before the tarball is built, then restore the source after. Source stays workspace-friendly; published artifacts carry real version strings.

The `create-mcp-server` scaffold tool (`src/scaffold.ts`) further rewrites these deps to the SDK's `package.json` version when users create new projects, regardless of starting state.

## Requirements

- Node.js 22+
- .NET 10 (for test Umbraco instance)
- ESM modules (type: "module")
