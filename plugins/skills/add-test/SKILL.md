---
name: add-test
description: Add an integration test for a specific tool in an existing collection. Creates a test file following the collection's established patterns. Use when adding tests for new or modified tools, or re-creating deleted tests.
user_invocable: true
---

# Add Test

Add an integration test for a specific tool in an existing collection. This skill creates a single test file following the collection's established test patterns.

Use this skill when:
- You added a new tool with `/add-tool` and want to test it separately
- You manually created or modified a tool and need a test
- You deleted a test and need to recreate it
- `/build-tools-tests` skipped the collection because tests already exist

## Prerequisites

Before running, ensure:
1. The collection exists (`src/umbraco-api/tools/{collection}/index.ts`)
2. The test infrastructure exists (`src/umbraco-api/tools/{collection}/__tests__/setup.ts`) — if not, tell the user to run `/build-tools-tests {collection}` first
3. The project compiles: `npm run compile`
4. The Umbraco instance is running
5. An API user exists — remind the user: **"You need to create an API user via the Umbraco backoffice UI: Settings > Users, with Client ID `umbraco-back-office-mcp` and Client Secret `1234567890`"**

## Arguments

- **Collection name** (required): the collection containing the tool (e.g. `/add-test form`)
- **Tool name** (optional): the specific tool to test (e.g. `/add-test form copy-form`)

If no tool name is provided, compare the tools in the collection index against existing test files and present the untested tools to the user.

## Agents

| Agent | When to use |
|-------|-------------|
| `integration-test-creator` | Creating the test file (Step 3) |
| `integration-test-validator` | Validating the test (Step 4) |

## Critical Rules

**TEST INFRASTRUCTURE MUST EXIST.** This skill does not create `setup.ts`, builders, or helpers. If they don't exist, tell the user to run `/build-tools-tests {collection}` first.

**ONE FILE AT A TIME.** Create one test file, compile, run, fix. Then move to the next if testing multiple tools.

**RUN COMMANDS SEPARATELY.** Always run compile and test as separate Bash calls. Never chain with `&&`.

**REAL API — NO MOCKING.** These are integration tests against a real Umbraco instance. Do NOT create mock infrastructure.

**ONLY CREATE FILES IN `__tests__/`.** Do NOT modify tool files, collection indexes, API client files, or mock handlers.

## Workflow

### Step 0: Identify the Tool

If a tool name was provided, verify it exists in the collection index.

If no tool name was provided:
1. Read `src/umbraco-api/tools/{collection}/index.ts` to get the list of tools
2. List existing test files in `src/umbraco-api/tools/{collection}/__tests__/`
3. Identify tools without test files
4. Present the untested tools and ask which to test

### Step 1: Read Existing Patterns

Read the existing test infrastructure to match patterns:

- `src/umbraco-api/tools/{collection}/__tests__/setup.ts` — imports, re-exports, builder/helper names
- One or two existing test files — to match the assertion style, snapshot usage, builder patterns
- The tool file itself — to understand input schema, handler, slices

If `setup.ts` doesn't exist, stop and tell the user to run `/build-tools-tests {collection}` first.

### Step 2: Check Builder Coverage

Read the existing builder (`__tests__/helpers/{entity}-builder.ts`) to check if it supports creating the data needed for this tool's test.

If the builder needs a new method (e.g. `withCopiedFrom()` for a copy tool):
1. Add the method to the existing builder
2. Compile to verify
3. Continue

If the helper needs a new query method, add it to the existing helper file.

### Step 3: Create Test File

Use the `integration-test-creator` agent.

Create `src/umbraco-api/tools/{collection}/__tests__/{action}-{entity}.test.ts`:

- Import from `./setup.js` (matching the existing test import style)
- Use the existing builder for test data setup
- Follow snapshot testing for success cases (`createSnapshotResult` + `toMatchSnapshot`)
- Use assertion testing for error cases (`expect(result.isError).toBe(true)`)
- 1 happy path test + 1 error test (2-3 tests maximum)
- Clean up created data in `afterEach`

**After creating:**

```bash
npm run compile
```

```bash
npm test -- __tests__/{collection}/{action}-{entity}.test.ts
```

Fix any failures before proceeding.

### Step 4: Validate

Use the `integration-test-validator` agent to check the new test follows collection patterns:

- Uses `setupTestEnvironment()` in describe block
- Uses `createMockRequestHandlerExtra()` for handler calls
- Uses snapshot testing for success responses
- Uses the collection's builder for data setup
- Constants use `TEST_` prefix
- Reasonable test count (2-3 per tool)

### Step 5: Report

Report what was done:
- Test file created (path)
- Tests passing (count)
- Any builder/helper updates made
- Any validation findings
