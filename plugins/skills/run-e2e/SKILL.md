---
name: run-e2e
description: Run Playwright E2E tests for the hosted MCP Cloudflare Worker. Use this skill when the user says /run-e2e, "run e2e tests", "run the e2e", "run playwright tests", or wants to test the hosted worker end-to-end. Handles starting Umbraco, building, and running the full test suite.
---

# Run E2E Tests

Playwright-based E2E tests that drive the MCP Inspector UI through the full OAuth flow against the real Forms worker (`src/worker.ts`), which includes both Forms tool collections and in-process CMS chaining.

Key files:
- Test file: `tests/forms-hosted-e2e/e2e/mcp-inspector.test.ts`
- Worker setup: `tests/forms-hosted-e2e/e2e/helpers/worker-setup.ts`
- Wrangler config: `tests/forms-hosted-e2e/wrangler.e2e.toml`
- Shared test helpers from `@umbraco-cms/mcp-hosted/testing`

## Steps

### 1. Check prerequisites

- Verify `demo-site/` exists (has a `.csproj` file). If not, tell the user to run `npx create-umbraco-mcp-server init`.

### 2. Kill stale processes

Kill any stale processes on the E2E ports (Umbraco, Worker, Inspector):

```bash
npm run kill:e2e-ports
```

Tell the user which stale processes were found and killed.

### 3. Build the project

Build the worker before running tests:

```bash
npm run build
```

### 4. Start Umbraco as a background subprocess

Start Umbraco using the existing npm script with `run_in_background: true`:

```bash
npm run start:umbraco
```

Then wait for Umbraco to be ready. Run this single bash command which loops until the health check succeeds (up to 120 seconds):

```bash
for i in $(seq 1 24); do if curl -sk -o /dev/null -w '%{http_code}' https://localhost:44374 --max-time 5 | grep -q '200\|302'; then echo "Umbraco is ready"; exit 0; fi; echo "Waiting for Umbraco... (attempt $i/24)"; sleep 5; done; echo "Umbraco failed to start within 120s"; exit 1
```

Tell the user you're waiting for Umbraco to start. If the health check fails after 120 seconds, tell the user and stop.

### 5. Run the E2E tests

The Cloudflare Worker and MCP Inspector are started automatically by the test framework (via `worker-setup.ts` and shared helpers) — no manual setup needed.

Run the tests:

```bash
npm run test:e2e
```

If the user asked for a specific test, use:

```bash
npx playwright test --config tests/forms-hosted-e2e/e2e/playwright.config.ts -g "<test-name>"
```

**Useful flags** the user may request:
- `--headed` — watch tests in browser
- `--debug` — open Playwright Inspector
- `SLOW_MO=500` — slow down browser actions

### 6. Report results

Show the test results to the user. If tests failed, read the relevant test file and any error output to help diagnose.

### 7. Cleanup

Do NOT stop the Umbraco instance after tests — the user may want to run them again or use it for other work. Only stop it if the user explicitly asks.

## Prerequisites reference

These must be set up once (not part of the skill flow):

1. **Umbraco demo-site** in `demo-site/` directory
2. **Umbraco backoffice user** with credentials: `admin@test.com` / `SecurePass1234`
3. **OAuth client** `umbraco-mcp-forms-hosted` registered in the Umbraco backoffice
4. **Playwright browsers**: `npx playwright install`
