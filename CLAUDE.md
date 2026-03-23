# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monorepo for the Umbraco MCP (Model Context Protocol) Server SDK - infrastructure for building MCP servers that expose Umbraco APIs to AI assistants.

## Monorepo Structure

| Workspace | Description | Published |
|-----------|-------------|-----------|
| `packages/mcp-server-sdk/` | Core npm package `@umbraco-cms/mcp-server-sdk` | Yes |
| `template/` | Starter kit for new MCP server projects | No |
| `plugins/` | Claude Code plugins for Umbraco development | No |

Each workspace has its own CLAUDE.md with detailed guidance.

## Build Commands

```bash
npm install           # Install all workspace dependencies
npm run build         # Build SDK
npm run test          # Test SDK
```

Workspace-specific commands use `-w` flag: `npm run build -w packages/mcp-server-sdk`

## SDK Package Exports

| Entry Point | Purpose |
|-------------|---------|
| `@umbraco-cms/mcp-server-sdk` | Main: tool helpers, decorators, types, config loaders |
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

## Requirements

- Node.js 22+
- .NET 10 (for test Umbraco instance)
- ESM modules (type: "module")
