# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the MCP server template.

## Template Overview

Starter kit for creating new Umbraco MCP server projects. Copy this folder to start a new project. Not published to npm.

## Commands

```bash
npm run build          # Build with tsup
npm run compile        # Type-check only
npm run generate       # Generate API client from OpenAPI spec (Orval)
npm run inspect        # Run MCP inspector
npm run test           # Unit tests only
npm run test:evals     # LLM eval tests (requires ANTHROPIC_API_KEY)
npm run test:all       # Both unit and eval tests
```

**Single test:** `npm test -- --testPathPattern=src/path/__tests__/file.test.ts`

**Always use npm scripts** (`npm run compile`, `npm test`, `npm run build`) — never run `node`, `npx tsc`, or `jest` directly.

## Source Structure

```
src/
├── umbraco-api/
│   ├── api/
│   │   ├── client.ts          # API client configuration
│   │   └── generated/         # Orval-generated client and Zod schemas
│   ├── tools/
│   │   └── {collection-name}/
│   │       ├── index.ts       # ToolCollectionExport
│   │       ├── get/           # GET tools
│   │       ├── post/          # POST tools
│   │       ├── put/           # PUT tools
│   │       ├── delete/        # DELETE tools
│   │       ├── __tests__/     # Integration tests
│   │       └── __evals__/     # LLM eval tests
│   └── mcp-client.ts          # MCP chaining client instance
├── config/
│   ├── index.ts               # Exports all config
│   ├── server-config.ts       # Custom config field definitions
│   ├── slice-registry.ts      # Valid slice names
│   ├── mode-registry.ts       # Mode-to-collection mappings
│   └── mcp-servers.ts         # Chained MCP server configs
├── mocks/
│   ├── server.ts              # MSW server setup
│   ├── handlers.ts            # API mock handlers
│   ├── store.ts               # In-memory mock data
│   └── jest-setup.ts          # Test setup file
├── testing/                   # Test helpers specific to this project
└── index.ts                   # Server entry point
```

## Configuration

**Environment Variables / CLI Flags:**

| Variable | CLI Flag | Purpose |
|----------|----------|---------|
| `UMBRACO_CLIENT_ID` | `--umbraco-client-id` | OAuth client ID |
| `UMBRACO_CLIENT_SECRET` | `--umbraco-client-secret` | OAuth client secret |
| `UMBRACO_BASE_URL` | `--umbraco-base-url` | Umbraco instance URL |
| `UMBRACO_TOOL_MODES` | `--umbraco-tool-modes` | Comma-separated modes |
| `UMBRACO_INCLUDE_SLICES` | `--umbraco-include-slices` | Include only these slices |
| `UMBRACO_EXCLUDE_SLICES` | `--umbraco-exclude-slices` | Exclude these slices |
| `UMBRACO_READONLY` | `--umbraco-readonly` | Block write operations |
| `DISABLE_MCP_CHAINING` | `--disable-mcp-chaining` | Disable MCP server chaining |

Custom fields defined in `config/server-config.ts`.

## Registries

**slice-registry.ts** - Valid slice names for tool categorization:
- Base slices: `create`, `read`, `update`, `delete`, `list`
- Extended: `tree`, `search`, `publish`, `move`, `copy`, etc.
- Tools with empty slices array are categorized as `other`

**mode-registry.ts** - Named groups mapping to collections:
- Example: `example` mode includes `example` collection
- Users set `UMBRACO_TOOL_MODES=example,content` to enable groups

## Tool Conventions

- One file per tool in operation-type subfolder (`get/`, `post/`, etc.)
- Export default with `withStandardDecorators(tool)`
- Use Zod schemas from Orval-generated `*.zod.ts` files
- Set `slices` array for filtering categorization
- Set `annotations` for MCP hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`)

## Testing

**Integration tests (`__tests__/`):**
- Run against the real Umbraco instance — no mocking
- Require a running Umbraco instance with an API user configured (see below)
- Call `setupTestEnvironment()` in describe block
- Use builder pattern for test data (e.g., `ExampleBuilder`)
- Test tool handlers directly

**Eval tests (`__evals__/`):**
- LLM-based acceptance tests using Claude Agent SDK
- Require `ANTHROPIC_API_KEY` environment variable
- Use `runScenarioTest` with prompt, tools, requiredTools, successPattern
- Run with `--runInBand` to avoid parallel API calls

## API User Setup

Integration tests require an API user in Umbraco. **You must create this manually via the Umbraco backoffice UI:**

1. Go to **Settings > Users** in the Umbraco backoffice
2. Create an API user with:
   - **Client ID:** `umbraco-back-office-mcp`
   - **Client Secret:** `1234567890`
3. Grant the user appropriate permissions for the APIs being tested
4. Add these to your `.env` file:
   ```
   UMBRACO_CLIENT_ID=umbraco-back-office-mcp
   UMBRACO_CLIENT_SECRET=1234567890
   ```

## API Client

Uses Orval to generate typed client from OpenAPI spec:
1. Configure `orval.config.ts` with the Swagger URL
2. Run `npm run generate`
3. Client and Zod schemas generated to `src/umbraco-api/api/generated/`

Always pass `CAPTURE_RAW_HTTP_RESPONSE` to API methods when using toolkit helpers.
