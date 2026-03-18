# CLI Improvements for AI Agents

## Context

Based on [Justin Poehnelt's blog post](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/) about rewriting CLIs for AI agents. The post argues that **Agent DX optimizes for predictability and defense-in-depth**, unlike Human DX which optimizes for discoverability and forgiveness.

The SDK already covers several recommendations natively via MCP:
- **JSON payloads** → MCP tool calls are already JSON
- **Schema introspection** → MCP `tools/list` returns full schemas
- **Multi-surface** → Already have stdio + HTTP/SSE
- **Environment variable auth** → Already supported via env vars / CLI flags / `.env` file

This plan focuses on what's **NOT** already covered, implemented in the SDK so all MCP servers benefit.

**Branch:** `cli-improvements` (worktree from `dev`)

---

## Directory Structure

New code splits into two locations based on purpose:

- **`packages/mcp-server-sdk/src/helpers/`** — Input sanitization, dry-run, response trimming. These are tool handler decorators/utilities that apply to both MCP and CLI equally. They sit alongside existing `tool-decorators.ts` and `api-call-helpers.ts`.

- **`packages/mcp-server-sdk/src/cli/`** — **New directory.** CLI-only features: `--list-tools`, `--describe-tool`, `--generate-context`. These run before the MCP server starts and are purely for human/developer use from the command line. Not relevant to the MCP protocol path.

---

## Phase 1: Input Hardening Against Hallucinations

> "Assume all agent input is adversarial; agents hallucinate differently than humans typo"

### New: `packages/mcp-server-sdk/src/helpers/input-sanitizer.ts`

Validation functions that throw `ToolValidationError` with clear messages for agent self-correction:

| Function | Purpose |
|----------|---------|
| `rejectControlCharacters(value, fieldName)` | Reject ASCII < 0x20 (except \t, \n, \r) |
| `rejectPathTraversal(value, fieldName)` | Reject `../`, `..\\`, absolute paths |
| `rejectEmbeddedQueryParams(value, fieldName)` | Reject IDs containing `?` or `&` |
| `rejectPreEncodedStrings(value, fieldName)` | Reject `%XX` patterns (prevents double-encoding) |
| `sanitizeStringInput(value, fieldName, options?)` | Run all checks; options to opt-out of specific ones |
| `validateUUID(value, fieldName)` | Validate UUID v4 format (common in Umbraco APIs) |

### New: `withInputSanitization` decorator

- Walks all string fields in the tool's `inputSchema` Zod shape
- Runs `sanitizeStringInput` on each
- Fields with `[raw]` in `.describe()` are skipped (opt-out)

### Modify: `packages/mcp-server-sdk/src/helpers/tool-decorators.ts`

Add to `withStandardDecorators` chain:
```
withErrorHandling → withInputSanitization → withPreExecutionCheck → handler
```

### New: `packages/mcp-server-sdk/src/helpers/__tests__/input-sanitizer.test.ts`

---

## Phase 2: Context Window Discipline

> "Workspace APIs return massive JSON blobs. ALWAYS use field masks"

### Modify: `packages/mcp-server-sdk/src/helpers/api-call-helpers.ts`

Add optional `fields` and `excludeFields` to `ApiCallOptions`:
```typescript
fields?: string[];        // Only include these top-level keys
excludeFields?: string[]; // Exclude these top-level keys
```

Applied after response, before `createToolResult`. Simple pick/omit on top-level keys. Opt-in per tool.

### New: `packages/mcp-server-sdk/src/helpers/response-trimmer.ts`

| Function | Purpose |
|----------|---------|
| `trimArrayResponse(data, { maxItems })` | Limit list items, add `_truncated`/`_totalAvailable` metadata |
| `summarizeDeepResponse(data, { maxDepth })` | Collapse nested structures beyond depth into summaries |
| `estimateTokenSize(data)` | Rough token estimator (chars/4) for dynamic decisions |

### New: `packages/mcp-server-sdk/src/helpers/__tests__/response-trimmer.test.ts`

---

## Phase 3: Safety Rails (Dry-Run)

> "Validates requests locally without hitting API; prevents data loss from hallucinated parameters"

### New: `packages/mcp-server-sdk/src/helpers/dry-run.ts`

- `configureDryRunMode(enabled: boolean)` — module-level toggle
- `withDryRun` decorator — intercepts mutation tools (those without `readOnlyHint: true`) when active, returns:
  ```json
  { "dryRun": true, "toolName": "...", "wouldExecute": true, "inputReceived": {...}, "annotations": {...} }
  ```
- Read-only tools execute normally even in dry-run mode

### Modify: `packages/mcp-server-sdk/src/config/config.ts`

Add config field: `{ name: "dryRun", envVar: "UMBRACO_DRY_RUN", cliFlag: "umbraco-dry-run", type: "boolean" }`

### Modify: `packages/mcp-server-sdk/src/helpers/tool-decorators.ts`

Updated chain:
```
withErrorHandling → withInputSanitization → withDryRun → withPreExecutionCheck → handler
```

Input sanitization still runs in dry-run mode so the agent gets validation feedback.

### New: `packages/mcp-server-sdk/src/helpers/__tests__/dry-run.test.ts`

---

## Phase 4: CLI Introspection & Agent Context

> "Make the CLI itself the documentation—queryable at runtime"

### New: `packages/mcp-server-sdk/src/cli/introspection.ts`

| Function | Purpose |
|----------|---------|
| `toolToJsonSchema(tool)` | Convert Zod inputSchema to JSON Schema |
| `toolToSummary(tool, collectionName)` | Structured summary object |
| `formatToolTable(summaries)` | Aligned text table for terminal |

### New: `packages/mcp-server-sdk/src/cli/context-generator.ts`

`generateContextFile(collections, options?)` → Generates a structured CONTEXT.md with:
- Server name/version
- Collection listing with descriptions
- Per-tool: name, description, parameters, slices, annotations
- Placeholder sections for workflows and invariants

### New: `packages/mcp-server-sdk/src/cli/index.ts`

Barrel export for the `cli/` directory.

### Modify: `packages/mcp-server-sdk/src/config/config.ts`

Add CLI-only flags (not env vars — development-time only):
- `--list-tools` — Print table of all tools (name, collection, slices, annotations) and exit
- `--describe-tool <name>` — Print full JSON Schema + metadata for one tool and exit
- `--generate-context` — Produce CONTEXT.md to stdout and exit

Auth is still required for these commands — consistent with the principle that all CLI operations require authentication. The introspection flags run after auth/config resolution, using the same credential validation path as normal operation.

### Modify: `template/src/index.ts`

Handle `--list-tools`, `--describe-tool`, and `--generate-context` after loading collections and validating auth, but before starting MCP server. Exit immediately after output.

---

## Phase 5: CLI Integration Tests

> Deterministic tests that exercise the built CLI binary end-to-end via MCP protocol

### New: `template/tests/cli/` directory

**Approach:** Use `@modelcontextprotocol/sdk`'s `Client` + `StdioClientTransport` to connect to the built CLI binary as a proper MCP client. No LLM needed — direct programmatic MCP calls.

**Auth:** Uses `USE_MOCK_API=true` (existing MSW mock server in template) with dummy credentials. No real Umbraco instance needed.

### New: `template/tests/cli/helpers/cli-client.ts`

Helper that:
1. Spawns `node dist/index.js` with env vars (`USE_MOCK_API=true`, dummy auth)
2. Connects via `StdioClientTransport` as an MCP client
3. Returns a test client with methods: `listTools()`, `callTool(name, args)`, `close()`

### New: `template/tests/cli/__tests__/input-sanitization.test.ts`

Test the input hardening layer end-to-end:
- Control characters in string fields → rejected with clear error
- Path traversal attempts → rejected
- Embedded query params in UUIDs → rejected
- Pre-encoded strings → rejected
- Valid inputs → pass through normally
- `[raw]` opt-out fields → bypass sanitization

### New: `template/tests/cli/__tests__/dry-run.test.ts`

Test dry-run mode end-to-end:
- Start CLI with `UMBRACO_DRY_RUN=true`
- Call a read-only tool → executes normally
- Call a mutation tool → returns dry-run response (no API hit)
- Verify dry-run response structure

### New: `template/tests/cli/__tests__/introspection.test.ts`

Test CLI introspection commands:
- `--list-tools` → outputs valid table with all registered tools, then exits
- `--describe-tool <name>` → outputs JSON Schema for specific tool, then exits
- `--describe-tool nonexistent` → outputs error message, then exits
- `--generate-context` → outputs valid markdown, then exits

### New: `template/tests/cli/__tests__/tool-execution.test.ts`

Basic end-to-end tool execution:
- `tools/list` returns expected tools with schemas
- Calling a GET tool returns structured response
- Calling a tool with invalid input returns ProblemDetails error
- Response trimming/field masking works when configured

### Modify: `template/package.json`

Add script: `"test:cli": "npm run build && jest --config tests/cli/jest.config.ts"`

### New: `template/tests/cli/jest.config.ts`

Separate Jest config for CLI integration tests (similar pattern to `tests/evals/jest.config.ts`).

---

## Phase 6: Export & Wire Up

### Modify: `packages/mcp-server-sdk/src/index.ts`

Export new modules from the main entry point:
- From `helpers/`: `input-sanitizer`, `response-trimmer`, `dry-run`
- From `cli/`: `introspection`, `context-generator`

### Consider: new `@umbraco-cms/mcp-server-sdk/cli` entry point

If the CLI utilities grow, consider a separate package export path (like `./testing` and `./evals` already exist). For now, export from main entry point.

---

## Implementation Order

| Phase | Dependencies | Impact |
|-------|-------------|--------|
| 1 — Input Hardening | None | High — security foundation |
| 2 — Context Window | None | High — agent performance |
| 3 — Dry-Run | Phase 1 (decorator chain) | Medium — mutation safety |
| 4 — CLI Introspection | None | Medium — DX improvement |
| 5 — CLI Integration Tests | Phases 1-4 (features to test) | High — test coverage |
| 6 — Exports | All phases | Wiring |

Phases 1, 2, and 4 can be developed in parallel.

---

## Key Files

| File | Action |
|------|--------|
| `packages/mcp-server-sdk/src/helpers/tool-decorators.ts` | Modify — add decorators to chain |
| `packages/mcp-server-sdk/src/helpers/api-call-helpers.ts` | Modify — add field mask options |
| `packages/mcp-server-sdk/src/config/config.ts` | Modify — add dry-run + CLI flags |
| `packages/mcp-server-sdk/src/index.ts` | Modify — export new modules |
| `template/src/index.ts` | Modify — handle introspection flags |
| `template/package.json` | Modify — add `test:cli` script |
| `packages/mcp-server-sdk/src/helpers/input-sanitizer.ts` | **New** |
| `packages/mcp-server-sdk/src/helpers/response-trimmer.ts` | **New** |
| `packages/mcp-server-sdk/src/helpers/dry-run.ts` | **New** |
| `packages/mcp-server-sdk/src/cli/introspection.ts` | **New** |
| `packages/mcp-server-sdk/src/cli/context-generator.ts` | **New** |
| `packages/mcp-server-sdk/src/cli/index.ts` | **New** |
| `template/tests/cli/helpers/cli-client.ts` | **New** |
| `template/tests/cli/jest.config.ts` | **New** |
| `template/tests/cli/__tests__/input-sanitization.test.ts` | **New** |
| `template/tests/cli/__tests__/dry-run.test.ts` | **New** |
| `template/tests/cli/__tests__/introspection.test.ts` | **New** |
| `template/tests/cli/__tests__/tool-execution.test.ts` | **New** |

## Existing Code to Reuse

- `ToolValidationError` (`helpers/tool-validation-error.ts`) — for input validation errors
- `createToolResult` / `createToolResultError` (`helpers/tool-result.ts`) — for dry-run responses
- `compose()` function (`helpers/tool-decorators.ts`) — for decorator composition
- `ConfigFieldDefinition` pattern (`config/config.ts`) — table-driven config for new flags
- `createToolAnnotations()` (`helpers/tool-decorators.ts`) — for dry-run annotation inspection
- `StdioClientTransport` from `@modelcontextprotocol/sdk` — for CLI integration test client
- MSW mock server (`USE_MOCK_API=true`) — fake API backend for integration tests
- `tests/evals/jest.config.ts` — pattern for separate Jest config

## Verification

1. `npm run build` — SDK builds cleanly
2. `npm run test` — All existing + new unit tests pass
3. `npm run build -w template && npm run compile -w template` — Template still compiles
4. `npm run test:cli -w template` — All CLI integration tests pass
5. Manual: run template with `--list-tools` and `--describe-tool example-get-all-examples` to verify introspection
6. Manual: run template with `--umbraco-dry-run` and call a mutation tool via MCP inspector
