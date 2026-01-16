# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the `@umbraco-cms/mcp-toolkit` package.

## Package Overview

Core npm package providing infrastructure for building Umbraco MCP servers. Published to npm as `@umbraco-cms/mcp-toolkit`.

## Commands

```bash
npm run build          # Build with tsup
npm run compile        # Type-check only
npm run test           # Run tests
npm run test:watch     # Watch mode
npm run clean          # Remove dist/
```

**Single test:** `NODE_OPTIONS='--experimental-vm-modules' npx jest src/path/__tests__/file.test.ts`

## Source Structure

```
src/
├── helpers/           # Tool result formatting, API call helpers, decorators
├── types/             # ToolDefinition, ToolCollectionExport, etc.
├── config/            # Server configuration loading (getServerConfig)
├── tool-filtering/    # Mode/slice/collection filtering logic
├── mcp-client/        # MCP chaining (McpClientManager)
├── testing/           # Test utilities (setupTestEnvironment, snapshot helpers)
├── evals/             # LLM eval framework (runScenarioTest, agent-runner)
├── version-check/     # Umbraco version compatibility
├── file/              # File extension detection
└── constants/         # Umbraco well-known IDs
```

## Package Exports

| Entry Point | Modules |
|-------------|---------|
| `.` (main) | helpers, types, config, tool-filtering, mcp-client, version-check, constants |
| `./testing` | setupTestEnvironment, setupMswServer, snapshot normalization, mock helpers |
| `./evals` | runScenarioTest, runAgentTest, verification helpers, configureEvals |
| `./config` | getServerConfig |
| `./helpers` | API call helpers only |
| `./types` | Type definitions only |

## Key Exports

**Tool Creation:**
- `ToolDefinition<InputSchema, OutputSchema>` - Type-safe tool interface
- `ToolCollectionExport` - Collection grouping with metadata
- `withStandardDecorators` - Applies error handling + pre-execution checks
- `withErrorHandling`, `withPreExecutionCheck` - Individual decorators
- `createToolResult`, `createToolResultError` - Result formatting

**API Helpers:**
- `executeGetApiCall` - GET single item
- `executeGetItemsApiCall` - GET collections (wraps in `{ items: [...] }`)
- `executeVoidApiCall` - DELETE/PUT/POST without response body
- `CAPTURE_RAW_HTTP_RESPONSE` - Required option for all API calls
- `configureApiClient` - Set up the API client provider

**Tool Filtering:**
- `createCollectionConfigLoader` - Load filter config from registries
- `shouldIncludeTool`, `filterTools` - Apply filtering rules
- `validateSliceNames`, `validateModeNames` - Config validation
- `expandModesToCollections` - Resolve modes to collection lists

**Testing:**
- `setupTestEnvironment` - Mocks console.error in beforeEach/afterEach
- `setupMswServer` - MSW lifecycle for API mocking
- `createMockRequestHandlerExtra` - Handler context for tool tests

**Evals:**
- `runScenarioTest` - Test body function for Jest
- `runAgentTest` - Low-level agent execution
- `configureEvals` - Set up MCP server path and options
- `verifyRequiredToolCalls`, `verifySuccessMessage` - Assertions

## Testing Conventions

- Tests live in `__tests__/` directories adjacent to source
- Test files named `*.test.ts`
- Uses Jest with ESM (`--experimental-vm-modules`)
- Toolkit tests don't use MSW (unit tests only)

## Build

Uses tsup with multiple entry points. Output to `dist/` with `.js` and `.d.ts` files.
