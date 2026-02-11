---
name: build-tools-tests
description: Build integration tests for MCP tool collections. Reads .discover.json and creates test setup, builders, helpers, and test files per collection. Use after running '/build-tools'.
user_invocable: true
---

# Build Tests

Generate integration tests for MCP tool collections created by `/build-tools`. This skill reads `.discover.json` and the existing tool files, then builds test infrastructure and test files one collection at a time.

**IMPORTANT: This skill ONLY creates files inside `__tests__/` directories — test files, setup, builders, and helpers. Do NOT create or modify ANY other files. This means: no tool files, no collection indexes, no registrations, no API client files (`src/umbraco-api/api/`), no generated code (`src/umbraco-api/api/generated/`), no mock handlers (`src/mocks/`). If existing code doesn't support what you need, work within the constraints — do not modify it.**

## Prerequisites

Before running, ensure:
1. You have run `/build-tools` (tool collections exist in `src/umbraco-api/tools/`)
2. The project compiles: `npm run compile`
3. The Umbraco instance is running
4. An API user exists — remind the user: **"You need to create an API user via the Umbraco backoffice UI: Settings > Users, with Client ID `umbraco-back-office-mcp` and Client Secret `1234567890`"**

## Arguments

- No arguments: build tests for all collections from `.discover.json`
- Single collection name: build tests only for that collection (e.g. `/build-tools-tests form`)

## Agents

This skill orchestrates the following agents — use them for the relevant steps:

| Agent | When to use |
|-------|-------------|
| `test-builder-helper-creator` | Creating builders and helpers (Steps 4-5) |
| `integration-test-creator` | Creating test files (Step 7) |
| `integration-test-validator` | Validating test quality (Step 8) |

## Critical Rules

**ONE FILE AT A TIME.** This applies to ALL files — builders, helpers, builder tests, and tool tests. After creating any file:
1. Compile: `npm run compile`
2. If it has tests, run them: `npm test -- path/to/file.test.ts`
3. Fix any failures
4. Only then create the next file

**RUN COMMANDS SEPARATELY.** Always run compile and test as separate Bash calls. Never chain them with `&&`.

**NEVER:**
- Create multiple files at once
- Move on while a compile error or test failure exists
- Skip the compile step
- Assume anything works without running it
- Chain commands with `&&` (run each command separately)

**ONE TEST FILE PER TOOL.** Every tool gets its own test file. Never combine tests for multiple tools into one file.

**SNAPSHOT TESTING PREFERRED.** Use `createSnapshotResult` from `@umbraco-cms/mcp-server-sdk/testing` with `toMatchSnapshot()` for success responses. Only use assertion testing (`expect(x).toBe(y)`) for error cases where `isError` is checked.

**REAL API — NO MOCKING.** These are integration tests that run against a real Umbraco instance. Do NOT set `USE_MOCK_API`. Do NOT create, modify, or reference anything in `src/mocks/`. Do NOT import `server` from mocks. Do NOT add MSW handlers. Do NOT use any mocking framework. The tests call tool handlers directly and those handlers call the real API. If a test fails, the fix is in the test or the tool — never add mock infrastructure.

## Umbraco Instance Management

If testing hits roadblocks — builders can't create data, APIs reject requests due to missing configuration, or features aren't available — you are able to manipulate the Umbraco instance to your needs. You can add connection strings, change settings, install packages, or even write C# code in `demo-site/`. **Read `instance-management.md` in this skill directory for the full process and concrete examples.**

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

### Step 1: Understand Existing Tools

For each collection, read:
- `src/umbraco-api/tools/{collection}/index.ts` — to get the list of tools
- Each tool file — to understand input schemas, handler logic, and entity names
- `src/umbraco-api/api/generated/` — to identify the API client function and Zod schemas

If `src/umbraco-api/tools/{collection}/index.ts` doesn't exist, skip — tell the user to run `/build-tools` first.

### Step 2: Check for Existing Tests

**Skip if `src/umbraco-api/tools/{collection}/__tests__/setup.ts` already exists** — tests have already been created for this collection.

### Step 3: Per Collection — Create Test Setup

Create `src/umbraco-api/tools/{collection}/__tests__/setup.ts`:

```typescript
import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  createSnapshotResult,
} from "@umbraco-cms/mcp-server-sdk/testing";
import { configureApiClient } from "@umbraco-cms/mcp-server-sdk";
import { getYourAPI } from "../../../../api/generated/yourApi.js";
import { EntityBuilder } from "./helpers/{entity}-builder.js";
import { EntityTestHelper } from "./helpers/{entity}-test-helper.js";

configureApiClient(() => getYourAPI());

export {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  createSnapshotResult,
  EntityBuilder,
  EntityTestHelper,
};
```

**Key rules:**
- Import the correct API client getter from `src/umbraco-api/api/generated/`
- Do NOT set `USE_MOCK_API` — these tests run against the real Umbraco instance
- Export `createSnapshotResult` for snapshot testing
- Re-export builders and helpers so test files have a single import

**Compile after creating:** `npm run compile`. Fix errors before continuing.

### Step 4: Per Collection — Create Test Builder

Use the `test-builder-helper-creator` agent.

Create `src/umbraco-api/tools/{collection}/__tests__/helpers/{entity}-builder.ts`:

```typescript
const TEST_ENTITY_NAME = "_Test Entity";

interface EntityModel {
  name: string;
  // ... fields matching the create tool's input schema
}

export class EntityBuilder {
  private model: EntityModel = {
    name: TEST_ENTITY_NAME,
  };

  private createdId?: string;

  withName(name: string): this {
    this.model.name = name;
    return this;
  }

  build(): EntityModel {
    return { ...this.model };
  }

  async create(): Promise<this> {
    // Call the create tool's handler or API client directly
    return this;
  }

  getId(): string {
    if (!this.createdId) {
      throw new Error("Entity not created yet. Call create() first.");
    }
    return this.createdId;
  }
}
```

**Key rules:**
- Fluent interface — all `withX` methods return `this`
- `build()` returns the model, `create()` calls the API
- Store created ID for use in tests
- Use `TEST_` prefix for constants
- Match the create tool's input schema for the model fields

**Compile after creating:** `npm run compile`. Fix errors before continuing.

### Step 5: Per Collection — Create Test Helper

Use the `test-builder-helper-creator` agent.

Create `src/umbraco-api/tools/{collection}/__tests__/helpers/{entity}-test-helper.ts`:

```typescript
export class EntityTestHelper {
  static async findByName(name: string): Promise<any | undefined> {
    // Use list tool or API client to find entity
  }

  static async cleanup(namePrefix: string): Promise<void> {
    // List entities and delete those matching prefix
  }

  static normalizeIds(data: any): any {
    // Replace UUIDs with zeroed placeholder for snapshots
    if (Array.isArray(data)) {
      return data.map(item => this.normalizeIds(item));
    }
    if (data && typeof data === "object") {
      const normalized = { ...data };
      if (normalized.id) {
        normalized.id = "00000000-0000-0000-0000-000000000000";
      }
      for (const key of Object.keys(normalized)) {
        if (typeof normalized[key] === "object") {
          normalized[key] = this.normalizeIds(normalized[key]);
        }
      }
      return normalized;
    }
    return data;
  }
}
```

**Compile after creating:** `npm run compile`. Fix errors before continuing.

### Step 6: Per Collection — Create Builder Tests

Create `src/umbraco-api/tools/{collection}/__tests__/helpers/{entity}-builder.test.ts`:

```typescript
import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  EntityBuilder,
  EntityTestHelper,
} from "../setup.js";

const TEST_NAME = "_Test Builder Entity";

describe("EntityBuilder", () => {
  setupTestEnvironment();

  afterEach(async () => {
    await EntityTestHelper.cleanup(TEST_NAME);
  });

  it("should create entity with builder", async () => {
    const builder = await new EntityBuilder()
      .withName(TEST_NAME)
      .create();

    expect(builder.getId()).toBeDefined();

    const found = await EntityTestHelper.findByName(TEST_NAME);
    expect(found).toBeDefined();
    expect(found?.name).toBe(TEST_NAME);
  });
});
```

**After creating:**
1. Compile: `npm run compile`
2. Run: `npm test -- __tests__/{collection}/{entity}-builder.test.ts`
3. Fix any failures before continuing

### Step 7: Per Collection — Create Integration Tests

Use the `integration-test-creator` agent.

Create **one test file per tool**. Each tool gets its own `.test.ts` file. Create and run each sequentially.

#### Snapshot test pattern (preferred for success cases)

```typescript
import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  createSnapshotResult,
  EntityBuilder,
} from "./setup.js";
import getEntityTool from "../get/get-entity.js";

describe("get-entity", () => {
  setupTestEnvironment();

  it("should return entity by ID", async () => {
    const context = createMockRequestHandlerExtra();
    const builder = await new EntityBuilder()
      .withName("Test Entity")
      .create();

    const result = await getEntityTool.handler(
      { id: builder.getId() },
      context
    );

    expect(
      createSnapshotResult(result, builder.getId())
    ).toMatchSnapshot();
  });

  it("should return error for non-existent ID", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await getEntityTool.handler(
      { id: "00000000-0000-0000-0000-000000000000" },
      context
    );

    expect(result.isError).toBe(true);
  });
});
```

**Key rules:**
- Use `createSnapshotResult(result, id)` for success responses — it normalizes IDs, dates, and dynamic values
- Pass the created entity's ID as second argument to `createSnapshotResult` so it gets normalized
- Use `toMatchSnapshot()` — not `toMatchInlineSnapshot()`
- Only use assertion testing (`expect(x).toBe(y)`) for error cases
- Use builders to create test data when the test needs existing entities

#### File naming — one file per tool

| Tool file | Test file |
|-----------|-----------|
| `get/get-{entity}.ts` | `__tests__/get-{entity}.test.ts` |
| `get/list-{entities}.ts` | `__tests__/list-{entities}.test.ts` |
| `post/create-{entity}.ts` | `__tests__/create-{entity}.test.ts` |
| `put/update-{entity}.ts` | `__tests__/update-{entity}.test.ts` |
| `delete/delete-{entity}.ts` | `__tests__/delete-{entity}.test.ts` |

#### Test scope per tool

- **1 happy path test** — use snapshot testing
- **1 error test** — use assertion testing (`isError`)
- **Maximum 2-3 tests per tool**

#### Sequential process per file

For each test file:
1. Write the test
2. Compile: `npm run compile`
3. Run: `npm test -- __tests__/{collection}/{test-file}.test.ts`
4. Fix any failures before creating the next test file

### Step 8: Validate with `integration-test-validator`

After all test files pass for a collection, run the `integration-test-validator` agent. The agent will check:

- `setupTestEnvironment()` used in every describe block
- `configureApiClient()` called in setup.ts
- `createMockRequestHandlerExtra()` used for all handler calls
- Snapshot testing used for success responses (`createSnapshotResult` + `toMatchSnapshot`)
- One test file per tool (no combined test files)
- Builder and helper files in `__tests__/helpers/` directory
- Builder test file exists and passes
- Constants at file head with `TEST_` prefix
- No mock mode (`USE_MOCK_API` is NOT set — tests hit the real API)
- Test count reasonable (2-3 per tool)

Flag any issues but continue to the next collection.

### Step 9: Next Collection

Repeat steps 3-8 for the next collection in `.discover.json`.

### Step 10: Final Verification

After all collections have tests:

```bash
npm run compile    # Full type check
npm test           # All integration tests
```

Report what was generated:
- Number of collections with tests
- Number of test files per collection (should be: 1 builder test + 1 per tool)
- Any quality issues found
- Any collections skipped (already had tests)

## File Structure

After running, each collection should have:

```
src/umbraco-api/tools/{collection}/
└── __tests__/
    ├── setup.ts                        # Shared setup, re-exports
    ├── helpers/
    │   ├── {entity}-builder.ts         # Fluent builder
    │   ├── {entity}-builder.test.ts    # Tests the builder itself
    │   └── {entity}-test-helper.ts     # Find, cleanup, normalizeIds
    ├── get-{entity}.test.ts            # One file per tool
    ├── list-{entities}.test.ts
    ├── create-{entity}.test.ts
    ├── update-{entity}.test.ts
    └── delete-{entity}.test.ts
```
