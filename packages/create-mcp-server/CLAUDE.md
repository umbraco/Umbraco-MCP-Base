# CLAUDE.md — create-mcp-server

CLI scaffolding tool for creating Umbraco MCP server projects.

## Commands

```bash
npm run build           # Build CLI + copy template to dist/
npm run compile         # Type-check only
npm test                # Unit tests (121 tests)
npm run test:e2e        # New-instance E2E test — PSW-driven fresh Umbraco (requires SQL Server + .NET 10)
npm run test:e2e:existing # Existing-instance E2E test — points CLI at a running Umbraco (requires SQL Server + .NET 10)
npm run test:e2e:skills # Skill E2E test (requires Claude Code subscription)
npm run test:e2e:revert # Reset skill output for re-run
npm run test:e2e:cleanup # Tear down preserved E2E assets
```

## E2E Testing

### Prerequisites
- SQL Server (local or Docker)
- .NET 10 SDK
- PSW CLI (`dotnet tool install -g PackageScriptWriter.Cli`)

### New-instance E2E (deterministic, always passes)

Tests the full CLI pipeline for the `init` "Create new instance" branch: scaffold → init → PSW-create Umbraco → start → discover → generate → compile → test → API calls → hosted worker.

```bash
TEST_SQL_CONNECTION_STRING="Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=True" \
npm run test:e2e -w packages/create-mcp-server
```

### Skill E2E (non-deterministic, uses Claude Agent SDK)

Tests `/build-tools` and `/build-tools-tests` skills against the Language API group.

**Three-step workflow for fast iteration:**

```bash
# Step 1: Create project + start Umbraco (preserves assets for reuse)
KEEP_E2E_ASSETS=true \
TEST_SQL_CONNECTION_STRING="Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=True" \
npm run test:e2e -w packages/create-mcp-server

# Step 2: Run skill tests (reuses project from step 1 — fast!)
npm run test:e2e:skills -w packages/create-mcp-server

# Step 2b: If skills failed, revert and try again
npm run test:e2e:revert -w packages/create-mcp-server
npm run test:e2e:skills -w packages/create-mcp-server

# Step 3: Clean up when done
npm run test:e2e:cleanup -w packages/create-mcp-server
```

### Container Mode E2E

Tests the container mode init flow (no API tools, keeps chaining). Runs as part of `npm run test:e2e`.

### Existing-instance E2E

Self-contained E2E for the `init` "Use existing instance" branch. Spawns a copy of `tests/umbraco-instance/` (.NET 10) on a random port, overrides its connection string to use a per-test SQL Server database (so it aligns with the real-world setup tested in the new-instance E2E), scaffolds a project, runs the init pipeline against the running site, and asserts `.env`, `orval.config.ts`, and a real API call.

```bash
TEST_SQL_CONNECTION_STRING="Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=True" \
npm run test:e2e:existing -w packages/create-mcp-server
```

## CLI Subcommands

| Command | Description |
|---------|-------------|
| `create <name>` | Scaffold a new project (default when no subcommand) |
| `init` | Configure project: Umbraco instance, tool mode, features |
| `discover` | Discover APIs, create API user, generate client, write .discover.json |

## Init Flow

1. **Umbraco instance** — create (PSW) / existing / skip
2. **Tool mode** — API tools (default) / Container mode
3. **Feature questions** — mocks, chaining, evals

## Umbraco API spec convention (17 vs 18)

Umbraco renamed its OpenAPI endpoints at **Umbraco 18** (Swashbuckle →
`Microsoft.AspNetCore.OpenApi`). This is the one place the CLI cares about the
target's major version, and it is **codified in one module**:
`src/discover/api-spec-conventions.ts` (`OPENAPI_SWITCH_MAJOR = 18`).

| Concern         | Umbraco ≤ 17 (`swagger`)                | Umbraco 18+ (`openapi`)                 |
| --------------- | --------------------------------------- | --------------------------------------- |
| Spec document   | `/umbraco/swagger/{name}/swagger.json`  | `/umbraco/openapi/{name}.json`          |
| Docs UI         | `/umbraco/swagger/`                     | `/umbraco/openapi/`                     |
| OAuth2 redirect | `/umbraco/swagger/oauth2-redirect.html` | `/umbraco/openapi/oauth2-redirect.html` |
| Spec version    | OpenAPI 3.0                             | OpenAPI 3.1                             |

Unchanged across the switch: the OAuth client id (`umbraco-swagger`) and the
Management API contract (`/umbraco/management/api/v1/...`).

**The CLI is not told which version it targets** — it probes the newer
(`openapi`) convention first and falls back to `swagger`, so a single build
works against Umbraco 17 (LTS) and 18+. `discover-swagger.ts`, `health-check.ts`,
and `check-api-user.ts` all consume the convention helpers rather than hardcoding
paths. Orval (≥7.x) reads both 3.0 and 3.1 specs.

**Site creation** (`init` → "create") supports both: the version picker lists
every Umbraco ≥ the SDK's own major (`nuget-versions.ts`), so 17 and 18 are both
selectable, and PSW installs the chosen one via `--template-version`. A created
18 site flows straight into the `openapi` discovery path.

## Key Files

| File | Purpose |
|------|---------|
| `src/scaffold.ts` | Project scaffolding from template |
| `src/init/index.ts` | Init command orchestrator |
| `src/init/setup-instance.ts` | PSW + appsettings + Program.cs patching |
| `src/init/remove-api-tools.ts` | Container mode: strips API generation layer |
| `src/discover/index.ts` | Discover command orchestrator |
| `src/discover/api-spec-conventions.ts` | Single source of truth for the swagger (≤17) ↔ openapi (18+) URL switch |
| `src/discover/check-api-user.ts` | Auto-creates API user via OAuth + PKCE |
| `tests/e2e/new-instance-e2e.test.ts` | New-instance E2E test — PSW-driven fresh Umbraco (19 deterministic steps) |
| `tests/e2e/existing-instance-e2e.test.ts` | Existing-instance E2E test — points CLI at a running Umbraco (3 steps) |
| `tests/e2e/skill-e2e.test.ts` | Skill E2E test (3 steps, uses Agent SDK) |
| `tests/e2e/cleanup-e2e.ts` | Cleanup/revert script for preserved assets |
