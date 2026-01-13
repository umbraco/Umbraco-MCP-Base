---
name: mcp-testing
description: Load MCP testing patterns for unit tests and eval tests using the @umbraco-cms/mcp-toolkit. Use when writing tests for MCP tools.
---

# MCP Testing Patterns

This skill loads comprehensive testing patterns for MCP tools using `@umbraco-cms/mcp-toolkit/testing` and `@umbraco-cms/mcp-toolkit/evals`.

## When to Use

Use this skill when:
- Creating unit tests for MCP tools
- Setting up eval/acceptance tests
- Understanding test infrastructure
- Debugging test failures

## Unit Testing

### Setup Pattern

```typescript
import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
} from "@umbraco-cms/mcp-toolkit/testing";
import { configureApiClient } from "@umbraco-cms/mcp-toolkit";
import { getYourAPI } from "../../api/generated/yourApi.js";
import yourTool from "../../tools/your-tool.js";

// Enable mock API
process.env.USE_MOCK_API = "true";

// Configure client (required for helpers)
configureApiClient(() => getYourAPI());

describe("your-tool", () => {
  setupTestEnvironment();

  it("should work", async () => {
    const context = createMockRequestHandlerExtra();
    const result = await yourTool.handler({ param: "value" }, context);

    expect(result.structuredContent).toBeDefined();
  });
});
```

### Key Testing Utilities

- `setupTestEnvironment()` - Suppresses console.error in tests
- `createMockRequestHandlerExtra()` - Creates mock MCP context for handler calls

### Test Structure

```
__tests__/
└── {entity}/
    ├── create-{entity}.test.ts
    ├── get-{entity}.test.ts
    └── delete-{entity}.test.ts
```

### Assertions

```typescript
// Success response
expect(result.structuredContent).toBeDefined();
const content = result.structuredContent as any;
expect(content.fieldName).toBe("expectedValue");

// Error response
expect(result.isError).toBe(true);
```

## Eval Testing

Eval tests use an LLM agent to test tools end-to-end.

### Setup

```typescript
// __evals__/setup.ts
import path from "path";
import { configureEvals } from "@umbraco-cms/mcp-toolkit/evals";

configureEvals({
  mcpServerPath: path.resolve(process.cwd(), "dist/index.js"),
  mcpServerName: "my-mcp-server",
  serverEnv: { USE_MOCK_API: "true" },
  defaultModel: "claude-3-5-haiku-20241022",
  defaultMaxTurns: 10,
  defaultMaxBudgetUsd: 0.25,
  defaultTimeoutMs: 60000,
});
```

### Test Pattern

```typescript
import "./setup.js";
import { describe, it } from "@jest/globals";
import {
  runScenarioTest,
  setupConsoleMock,
  getDefaultTimeoutMs,
} from "@umbraco-cms/mcp-toolkit/evals";

describe("entity evals", () => {
  setupConsoleMock();

  it(
    "should complete workflow",
    runScenarioTest({
      prompt: `Complete these tasks:
1. Create an item named "Test"
2. Delete the item
3. Say "Workflow completed"`,
      tools: ["create-item", "delete-item"],
      requiredTools: ["create-item", "delete-item"],
      successPattern: "Workflow completed",
    }),
    getDefaultTimeoutMs()
  );
});
```

### Running Tests

```bash
# Unit tests
npm test

# Eval tests (requires build first)
npm run build
npm run test:evals

# Verbose eval output
E2E_VERBOSITY=verbose npm run test:evals
```

## Test Best Practices

### Unit Tests
- Use `TEST_` prefix for constants
- Each test creates fresh data
- Clean up after tests if creating real entities
- Focus on happy path + basic error cases
- 2-3 tests per tool maximum

### Eval Tests
- Always build before running
- Use unique identifiers (timestamps)
- Clear step-by-step prompts
- Search for IDs dynamically
- Enable verbose mode during development

## Debugging

### Unit Tests
```bash
# Run specific test
npm test -- __tests__/entity/get-entity.test.ts

# With verbose output
npm test -- --verbose
```

### Eval Tests
```bash
# Verbose mode shows full conversation
E2E_VERBOSITY=verbose npm run test:evals

# Run specific eval file
npm run test:evals -- __evals__/entity.eval.ts
```

## Common Issues

| Issue | Solution |
|-------|----------|
| "API client not configured" | Call `configureApiClient()` before tests |
| Mock not working | Ensure `USE_MOCK_API=true` |
| Handler not defined | Import tool correctly |
| Eval timeout | Increase `maxTurns` or simplify prompt |
