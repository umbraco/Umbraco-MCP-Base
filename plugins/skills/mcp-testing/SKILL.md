---
name: mcp-testing
description: Load MCP eval testing patterns using @umbraco-cms/mcp-server-sdk/evals. Use when writing LLM-based acceptance tests for MCP tools.
---

# MCP Eval Testing Patterns

This skill loads eval testing patterns for MCP tools using `@umbraco-cms/mcp-server-sdk/evals`. Eval tests verify tools work correctly when driven by an LLM agent.

For integration tests, use `/build-tools-tests` instead.

## When to Use

Use this skill when:
- Creating eval/acceptance tests for MCP tools
- Verifying tools work correctly in LLM-driven workflows
- Debugging eval test failures

## Setup

```typescript
// __evals__/setup.ts
import path from "path";
import { configureEvals } from "@umbraco-cms/mcp-server-sdk/evals";

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

## Test Pattern

```typescript
import "./setup.js";
import { describe, it } from "@jest/globals";
import {
  runScenarioTest,
  setupConsoleMock,
  getDefaultTimeoutMs,
} from "@umbraco-cms/mcp-server-sdk/evals";

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

## Key Concepts

### runScenarioTest Options

| Option | Purpose |
|--------|---------|
| `prompt` | Step-by-step instructions for the LLM |
| `tools` | Tools available to the LLM agent |
| `requiredTools` | Tools that must be called for the test to pass |
| `successPattern` | String the LLM must output to indicate success |

### Writing Good Prompts

- Use numbered step-by-step instructions
- Be explicit about what to do with results ("get details for the first one")
- Use unique identifiers with timestamps to avoid collisions
- End with a specific success phrase ("Say 'Workflow completed'")
- Search for IDs dynamically — don't hardcode them

### Grouping Related Tools

Group tools that work together in a single eval test to verify the workflow:

```typescript
it(
  "should create, list, and delete",
  runScenarioTest({
    prompt: `Complete these tasks:
1. Create a form named "Test Form ${Date.now()}"
2. List all forms and confirm the new one appears
3. Delete the form you created
4. Say "CRUD workflow completed"`,
    tools: ["create-form", "list-forms", "delete-form"],
    requiredTools: ["create-form", "list-forms", "delete-form"],
    successPattern: "CRUD workflow completed",
  }),
  getDefaultTimeoutMs()
);
```

## Running Eval Tests

```bash
# Build first (evals run against dist/)
npm run build

# Run all evals
npm run test:evals

# Run specific eval file
npm run test:evals -- __evals__/entity.eval.ts

# Verbose mode shows full LLM conversation
E2E_VERBOSITY=verbose npm run test:evals
```

## Best Practices

- Always build before running evals (`npm run build`)
- Use unique identifiers (timestamps) to avoid test data collisions
- Clear step-by-step prompts work better than vague instructions
- Search for IDs dynamically — don't assume IDs exist
- Enable verbose mode during development to see the full conversation
- Keep `maxBudgetUsd` low to catch inefficient tool usage

## Debugging

```bash
# Verbose mode shows full conversation
E2E_VERBOSITY=verbose npm run test:evals

# Run specific eval file
npm run test:evals -- __evals__/entity.eval.ts
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Eval timeout | Increase `maxTurns` or simplify prompt |
| Wrong tool selected | Improve tool description clarity |
| Missing parameters | Add examples to tool descriptions |
| Tool not found | Check tool name matches exactly |
| Budget exceeded | Simplify workflow or increase `maxBudgetUsd` |
