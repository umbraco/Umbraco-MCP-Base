---
name: add-tool
description: Add a new tool to an existing MCP collection. Creates the tool file, updates the collection index, optionally adds integration tests and eval tests. Use when adding new API endpoints to collections already created by '/build-tools'.
user_invocable: true
---

# Add Tool

Add one or more new tools to an existing MCP collection. This skill handles creating the tool file, updating the collection index, and optionally adding integration tests and eval tests.

Use this skill when:
- A new API endpoint has been added and needs a tool
- You want to expose an additional operation from an existing collection
- `/build-tools` skipped the collection because it already has an `index.ts`

## Prerequisites

Before running, ensure:
1. The collection already exists (`src/umbraco-api/tools/{collection}/index.ts`)
2. The API client has been generated (`src/umbraco-api/api/generated/` exists — if not, run `npm run generate`)
3. The project compiles: `npm run compile`

## Arguments

- **Collection name** (required): the collection to add the tool to (e.g. `/add-tool form`)
- **Operation hint** (optional): a description of the endpoint to add (e.g. `/add-tool form "copy form endpoint"`)

If no arguments are provided, ask the user which collection and what endpoint to add.

## Agents

This skill orchestrates the following agents:

| Agent | When to use |
|-------|-------------|
| `mcp-tool-creator` | Creating the tool file (Step 3) |
| `mcp-tool-description-writer` | Writing the tool description (Step 3) |
| `mcp-tool-reviewer` | Reviewing the new tool for LLM-readiness (Step 5) |
| `integration-test-creator` | Creating an integration test for the new tool (Step 6) |
| `eval-test-creator` | Updating eval tests to cover the new tool (Step 7) |

## Critical Rules

**ONE TOOL AT A TIME.** Create one tool file, compile, verify, then move to the next if adding multiple.

**RUN COMMANDS SEPARATELY.** Always run compile and test as separate Bash calls. Never chain with `&&`.

**DO NOT RECREATE EXISTING INFRASTRUCTURE.** The collection index, test setup, builders, and helpers already exist. This skill only adds new files and updates existing ones.

## Workflow

### Step 0: Understand the Request

Read the arguments to determine:
- Which collection to add to
- What endpoint(s) to add

If no operation hint was given, read `.discover.json` and the Swagger spec to identify operations that don't have tool files yet. Present the options to the user and ask which to add.

### Step 1: Read Existing Collection

Read the existing collection to understand current patterns:

- `src/umbraco-api/tools/{collection}/index.ts` — current tool exports and collection metadata
- A few existing tool files in the collection — to match patterns (import style, API client usage, naming conventions)
- `src/umbraco-api/api/generated/` — to find the client method and Zod schemas for the new endpoint

If the collection doesn't exist, tell the user to run `/build-tools {collection}` first.

### Step 2: Read Swagger Spec

Fetch the swagger spec from the `swaggerUrl` in `.discover.json`:

```bash
curl -sk {swaggerUrl}
```

Find the operation matching the requested endpoint. Collect:
- HTTP method
- Path
- operationId
- Summary
- Parameters and request body schema
- Response schema

### Step 3: Create Tool File

Use the `mcp-tool-creator` agent, then the `mcp-tool-description-writer` agent.

Create the tool file following the existing patterns in the collection. Use the same conventions for:
- File location (`get/`, `post/`, `put/`, `delete/` subdirectories)
- Import style (match how other tools in this collection import the API client)
- Naming (`{action}-{entity}.ts`)
- Slices and annotations (follow the standard mapping)

| HTTP Method | File pattern | Slice | Annotations |
|-------------|-------------|-------|-------------|
| GET (single) | `get/get-{entity}.ts` | `read` | `readOnlyHint: true` |
| GET (list) | `get/list-{entities}.ts` | `list` | `readOnlyHint: true` |
| GET (search) | `get/search-{entities}.ts` | `search` | `readOnlyHint: true` |
| POST | `post/create-{entity}.ts` | `create` | `destructiveHint: false, idempotentHint: false` |
| PUT/PATCH | `put/update-{entity}.ts` | `update` | `idempotentHint: true` |
| DELETE | `delete/delete-{entity}.ts` | `delete` | `destructiveHint: true` |

### Step 4: Update Collection Index

Add the new tool to `src/umbraco-api/tools/{collection}/index.ts`:

1. Add an import for the new tool (matching the existing import style)
2. Add the tool to the `tools` array

**Compile after updating:**

```bash
npm run compile
```

Fix any TypeScript errors before proceeding.

### Step 5: Review with `mcp-tool-reviewer`

Run the `mcp-tool-reviewer` agent on the **new tool only** (not the entire collection). Flag any issues.

### Step 6: Add Integration Test (if tests exist)

Check if the collection has integration tests (`src/umbraco-api/tools/{collection}/__tests__/setup.ts`).

If tests exist:

1. Use the `integration-test-creator` agent to create a test file for the new tool
2. Follow the existing test patterns in the collection (import from `setup.js`, use the same builder)
3. Create `src/umbraco-api/tools/{collection}/__tests__/{action}-{entity}.test.ts`
4. Compile: `npm run compile`
5. Run the new test: `npm test -- __tests__/{collection}/{action}-{entity}.test.ts`
6. Fix any failures

If tests don't exist, skip — tell the user they can run `/build-tools-tests {collection}` to generate the full test suite.

### Step 7: Update Eval Tests (if evals exist)

Check if the collection has eval tests (`tests/evals/{collection}-*.test.ts`).

If eval tests exist:

1. Read the existing eval test files to understand current workflow scenarios
2. Determine if the new tool fits into an existing scenario or needs a new one:
   - If it extends an existing workflow (e.g. adding an update tool to a collection that has a CRUD test), update the existing test to include the new tool
   - If it's a new capability (e.g. adding a search tool), use the `eval-test-creator` agent to create a new scenario
3. Build and run: `npm run build` then `npm run test:evals -- --testPathPatterns="{collection}"`

If eval tests don't exist, skip — tell the user they can run `/build-evals {collection}` to generate eval tests.

### Step 8: Report

Report what was done:
- Tool file created (path and name)
- Collection index updated
- Review findings (if any)
- Integration test created (or skipped with reason)
- Eval test updated/created (or skipped with reason)

If adding multiple tools, repeat steps 3-7 for each tool.

## File Structure

After running, the new tool will be at:

```
src/umbraco-api/tools/{collection}/
├── {method}/
│   └── {action}-{entity}.ts          # New tool file
├── index.ts                           # Updated with new export
└── __tests__/
    └── {action}-{entity}.test.ts      # New test (if tests exist)
```
