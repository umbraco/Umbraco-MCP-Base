---
name: build-evals
description: Build LLM eval tests for MCP tool collections. Reads .discover.json and creates eval setup and scenario test files per collection. Use after running '/build-tools'.
user_invocable: true
---

# Build Evals

Generate LLM eval tests for MCP tool collections created by `/build-tools`. This skill reads `.discover.json` and the existing tool files, then builds eval test files in `tests/evals/` one collection at a time.

**IMPORTANT: This skill ONLY creates files inside `tests/evals/` — the setup file and eval test files. Do NOT create or modify tool files, collection indexes, integration tests, mock handlers, or any other files.**

**Key difference from integration tests (`/build-tools-tests`):**
- Integration tests: one file per tool, test handlers directly against real API, deterministic
- Eval tests: group related tools by workflow, test via Claude Agent SDK, probabilistic, require `npm run build` first (run against `dist/`)

## Prerequisites

Before running, ensure:
1. You have run `/build-tools` (tool collections exist in `src/umbraco-api/tools/`)
2. The project builds: `npm run build`
3. An LLM API key is available (eval tests use Claude Agent SDK — works with a Claude Code subscription or `ANTHROPIC_API_KEY`)

## Arguments

- No arguments: build evals for all collections from `.discover.json`
- Single collection name: build evals only for that collection (e.g. `/build-evals form`)

## Agents

This skill orchestrates the following agent — use it for the relevant step:

| Agent | When to use |
|-------|-------------|
| `eval-test-creator` | Creating eval test files (Step 5) |

## Critical Rules

**BUILD BEFORE RUNNING.** Eval tests run against `dist/index.js`. Always `npm run build` first.

**ONE COLLECTION AT A TIME.** Complete each collection before starting the next.

**GROUP TOOLS BY WORKFLOW.** Unlike integration tests (one file per tool), eval tests group related tools into workflow scenarios. A collection with 5 tools might have just 1-2 eval test files.

**ITERATE ON PROMPTS.** Eval tests are probabilistic. If a test fails, the fix is usually in the prompt — make instructions more explicit, add search steps for IDs, use unique identifiers.

**VERBOSE DURING DEVELOPMENT.** Always set `verbose: true` when creating/debugging. Disable after tests pass reliably.

**RUN COMMANDS SEPARATELY.** Always run build and test as separate Bash calls. Never chain them with `&&`.

## Workflow

Process **one collection at a time**. Complete each collection fully before starting the next.

### Step 0: Read Discovery Manifest

Read `.discover.json` from the project root:

```json
{
  "apiName": "Umbraco Forms Management API",
  "swaggerUrl": "https://localhost:44324/umbraco/swagger/forms-management/swagger.json",
  "baseUrl": "https://localhost:44324",
  "collections": ["form", "form-template", "field-type", "folder"]
}
```

If an argument was provided, filter to only that collection. If `.discover.json` doesn't exist, tell the user to run `npx create-umbraco-mcp-server discover` first.

### Step 1: Check Prerequisites

For each collection, verify:
- `src/umbraco-api/tools/{collection}/index.ts` exists — if not, skip and tell the user to run `/build-tools` first

Check if eval tests already exist for this collection by looking for `tests/evals/{collection}-*.test.ts` files. **Skip if eval test files already exist** — evals have already been created for this collection.

Then ensure the eval setup exists and the project builds:

- If `tests/evals/helpers/e2e-setup.ts` doesn't exist, create it (Step 3)
- If `tests/evals/jest.config.ts` doesn't exist, create it (Step 3)

```bash
npm run build
```

Fix any build errors before continuing. Evals run against `dist/index.js` — if it doesn't build, evals can't run.

### Step 2: Read Tool Files

For each collection, read:
- `src/umbraco-api/tools/{collection}/index.ts` — to get the list of tools and collection metadata
- Each tool file — to understand:
  - Tool names
  - Input schemas (what parameters each tool accepts)
  - Descriptions (what each tool does)
  - Slices (read, list, create, update, delete, search, etc.)

Build a mental inventory of which operations are available. This determines what workflow scenarios to create.

### Step 3: Create Eval Setup (if not exists)

Eval tests use a centralized setup at `tests/evals/`. Only create these files if they don't already exist.

#### `tests/evals/jest.config.ts`

```typescript
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  rootDir: "../..",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  testMatch: ["<rootDir>/tests/evals/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/evals/helpers/e2e-setup.ts"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  maxConcurrency: 1,
  maxWorkers: 1,
  testTimeout: 120000,
  slowTestThreshold: 300,
};

export default config;
```

#### `tests/evals/helpers/e2e-setup.ts`

**Detect API mode:** Check if `src/mocks/` exists with handler files. If mocks exist, use `USE_MOCK_API: "true"`. Otherwise, configure for real API using `.env` credentials.

**Mock API setup** (if `src/mocks/` exists):

```typescript
import path from "path";
import { configureEvals, ClaudeModels } from "@umbraco-cms/mcp-server-sdk/evals";

configureEvals({
  mcpServerPath: path.resolve(process.cwd(), "dist/index.js"),
  mcpServerName: "{mcp-server-name}",
  serverEnv: {
    USE_MOCK_API: "true",
    DISABLE_MCP_CHAINING: "true",
    UMBRACO_CLIENT_ID: "test-client",
    UMBRACO_CLIENT_SECRET: "test-secret",
    UMBRACO_BASE_URL: "http://localhost:9999",
  },
  defaultModel: ClaudeModels.Haiku,
  defaultMaxTurns: 10,
  defaultMaxBudgetUsd: 0.25,
  defaultTimeoutMs: 60000,
});
```

**Real API setup** (no mocks):

```typescript
import path from "path";
import { configureEvals, ClaudeModels } from "@umbraco-cms/mcp-server-sdk/evals";

configureEvals({
  mcpServerPath: path.resolve(process.cwd(), "dist/index.js"),
  mcpServerName: "{mcp-server-name}",
  serverEnv: {
    UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID || "",
    UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET || "",
    UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL || "",
    DISABLE_MCP_CHAINING: "true",
  },
  defaultModel: ClaudeModels.Haiku,
  defaultMaxTurns: 10,
  defaultMaxBudgetUsd: 0.25,
  defaultTimeoutMs: 60000,
});
```

**Key rules:**
- Uses `process.cwd()` to resolve `dist/index.js` — setup runs from project root via Jest
- Get `mcpServerName` from `package.json` `name` field or `src/index.ts`
- Set `DISABLE_MCP_CHAINING: "true"` to avoid connecting to chained servers during tests
- Use conservative defaults: Haiku model, 10 turns, $0.25 budget, 60s timeout
- This file is loaded automatically via `setupFilesAfterEnv` — test files do NOT need to import it

Also ensure the `test:evals` script in `package.json` uses the dedicated config:

```json
"test:evals": "npm run build && node --experimental-vm-modules $(npm root)/jest/bin/jest.js --config tests/evals/jest.config.ts --runInBand --forceExit"
```

### Step 4: Design Eval Scenarios

Based on the tools available in the collection (from Step 2), design 1-2 workflow scenarios:

#### CRUD Lifecycle (if create + list/get + update + delete tools exist)

Test the full create-read-update-delete cycle:
1. Create an item with a unique name (use timestamp)
2. List items to confirm it was created
3. Get the specific item by ID
4. Update the item
5. Delete the item

#### Read-Only Workflow (if only get/list/search tools exist)

Test read operations:
1. List items
2. Get details for a specific item from the list

#### Search Workflow (if search + get tools exist)

Test search and retrieval:
1. Search for items matching a criteria
2. Get details for a result

#### Hierarchical Workflow (if folder/tree tools exist)

Test hierarchy operations:
1. Create a folder/container
2. Create an item inside the folder
3. List/navigate the hierarchy
4. Clean up

**Aim for 1-2 scenarios per collection.** A collection with CRUD tools needs one lifecycle test. A collection with only read tools needs one read-only test.

### Step 5: Create Eval Test Files

Use the `eval-test-creator` agent.

Create one file per workflow scenario in `tests/evals/`: `tests/evals/{collection}-{workflow}.test.ts`

#### File naming

| Workflow | File name |
|----------|-----------|
| CRUD lifecycle | `{collection}-crud.test.ts` |
| Read-only | `{collection}-read.test.ts` |
| Search | `{collection}-search.test.ts` |
| Hierarchical | `{collection}-hierarchy.test.ts` |

#### Test file pattern

```typescript
import { describe, it } from "@jest/globals";
import {
  runScenarioTest,
  setupConsoleMock,
  getDefaultTimeoutMs,
} from "@umbraco-cms/mcp-server-sdk/evals";

const COLLECTION_TOOLS = [
  "create-entity",
  "list-entities",
  "get-entity",
  "update-entity",
  "delete-entity",
] as const;

describe("{Collection} CRUD Operations", () => {
  setupConsoleMock();
  const timeout = getDefaultTimeoutMs();

  it(
    "should complete full CRUD workflow",
    runScenarioTest({
      prompt: `Complete these tasks in order:
1. Generate a unique identifier using the current timestamp
2. Create a new entity named "Eval Test {timestamp}" with description "Created by eval test"
3. List all entities and confirm the one you created appears in the results
4. Get the entity you created by its ID to verify the details
5. Update the entity name to "Updated Eval Test {timestamp}"
6. Delete the entity you created
7. Say "CRUD workflow completed successfully"`,
      tools: [...COLLECTION_TOOLS],
      requiredTools: ["create-entity", "list-entities", "get-entity", "update-entity", "delete-entity"],
      successPattern: "CRUD workflow completed successfully",
      verbose: true,
    }),
    timeout
  );
});
```

**Note:** No setup import needed — `e2e-setup.ts` is loaded automatically via `setupFilesAfterEnv` in `tests/evals/jest.config.ts`.

#### Prompt writing rules

- **Numbered steps** — clear, sequential instructions
- **Unique identifiers** — use timestamps to avoid collisions between test runs
- **Search for IDs dynamically** — never hardcode IDs, always find them via list/search
- **Success phrase at the end** — e.g., "Say 'Workflow completed successfully'"
- **Be explicit** — don't assume the LLM knows relationships between tools
- **Use actual tool names** — reference the exact tool names in the tools array

**Compile after creating:** `npm run compile`. Fix errors before continuing.

### Step 6: Build and Run

Build first (required — evals test against `dist/`):

```bash
npm run build
```

Then run the eval tests for this collection:

```bash
npm run test:evals -- --testPathPattern="{collection}"
```

#### If tests fail

1. Check build output — did `dist/index.js` get created?
2. Check verbose output — what did the LLM try to do?
3. Common fixes:
   - **Tool not found** — check tool names match exactly (use names from collection index)
   - **LLM ignores instructions** — make the prompt MORE explicit
   - **Timeout** — increase `defaultMaxTurns` or simplify the prompt
   - **Budget exceeded** — simplify the workflow or increase `defaultMaxBudgetUsd`
   - **Create returns void** — add a search/list step after create to find the ID
4. Update the prompt and re-run. Do NOT move to the next collection while tests fail.

### Step 7: Next Collection

Repeat steps 1-6 for the next collection in `.discover.json`.

### Step 8: Final Verification

After all collections have eval tests:

```bash
npm run build
```

```bash
npm run test:evals
```

Report what was generated:
- Number of collections with eval tests
- Number of eval test files per collection
- Workflow types tested (CRUD, read-only, search, hierarchy)
- Any collections skipped (already had eval tests)
- Any test failures that need attention

## File Structure

After running, the eval tests directory should contain:

```
tests/evals/
├── jest.config.ts                    # Separate Jest config for evals
├── helpers/
│   └── e2e-setup.ts                  # configureEvals setup (loaded via setupFilesAfterEnv)
├── {collection}-crud.test.ts         # CRUD lifecycle test (if applicable)
├── {collection}-read.test.ts         # Read-only test (if applicable)
└── ...
```

## Next Steps

After eval tests pass:
- Disable `verbose: true` in test files for cleaner CI output
- Run `/mcp-testing` for reference on advanced eval patterns
- Use eval feedback to improve tool descriptions and schemas (Phase 5.3 in the development loop)
