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
| `template/` | Starter kit for new MCP server projects (copied by create-mcp-server) | No |
| `plugins/` | Claude Code plugins for SDK development (building, testing) | No |
| `plugins-server/` | Claude Code plugins for server operations (CLI, configuration) | No |
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
| `npm run test:cli` | CLI integration tests — runs built template binary with filtering, introspection, dry-run, input sanitization | ~21 |
| `npm run test:integration` | Hosted MCP Wrangler integration tests | ~20 |
| `npm run test:integration:chained` | Chained hosted MCP integration tests | ~18 |

### Requires `npm run build` + running Umbraco instance (`dotnet run --project tests/umbraco-instance`)

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm run test:e2e` | Hosted MCP Playwright E2E — OAuth flow, tool selection, readOnly filtering via MCP Inspector | ~15 |
| `npm run test:e2e:chained` | Chained MCP Playwright E2E — chained tool discovery, consent screen, filtering | ~12 |

### Requires build + running Umbraco + MSW (automatic)

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm test -w template` | Template tool handler unit tests (MSW mocks API calls) | ~24 |

### Requires `ANTHROPIC_API_KEY` or Claude Code subscription

| Command | What it tests | Tests |
|---------|--------------|-------|
| `npm run test:cli:evals` | LLM eval tests — agent uses mcp-cli skill to run and interpret CLI commands | ~21 |

### Requires SQL Server + .NET 10

| Command | What it tests | Tests |
|---------|--------------|-------|
| `TEST_SQL_CONNECTION_STRING="..." npm run test:e2e -w packages/create-mcp-server` | Full CLI E2E — scaffold, init, Umbraco setup, discover, generate, compile, test | ~19 |

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

## Self-Signed Certificates

The local Umbraco instance uses HTTPS with self-signed certs. TLS rejection must be disabled in three places:
- Environment variable: `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Jest setup file: `https.globalAgent.options.rejectUnauthorized = false` (env var alone is insufficient in Jest VM context)
- Playwright config: `ignoreHTTPSErrors: true`

## Releases

All packages are versioned together and published from the `main` branch via Azure Pipelines.

### Release process

1. Create a release branch from `dev`: `release/<version>` (e.g. `release/17.0.0-beta.5`)
2. Bump the version in **all** package.json files and `marketplace.json`:
   - `package.json` (root)
   - `packages/mcp-server-sdk/package.json`
   - `packages/hosted-mcp/package.json`
   - `packages/create-mcp-server/package.json`
   - `template/package.json`
   - `plugins/package.json`
   - `.claude-plugin/marketplace.json` (both `metadata.version` and `plugins[0].version`)
3. Run `npm install --package-lock-only` to update `package-lock.json`
4. Commit, push, and create a PR from the release branch into `main`
5. The CI pipeline publishes packages when the PR is merged to `main`
6. Manually create a GitHub Release tagged `v<version>` from the merge commit

### Version scheme

- Prerelease: `17.0.0-beta.N` (published with `--tag beta` dist-tag)
- Stable: `17.0.0` (published with `--tag latest` dist-tag)

### Template `file:` references

The template's `package.json` uses `file:` references to `mcp-server-sdk` and `mcp-hosted` for monorepo development. The `create-mcp-server` scaffold tool (`src/scaffold.ts`) rewrites these to published npm versions when users create new projects.

## Requirements

- Node.js 22+
- .NET 10 (for test Umbraco instance)
- ESM modules (type: "module")
