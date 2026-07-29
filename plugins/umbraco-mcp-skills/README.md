# Umbraco MCP Skills

Professional Claude Code skills for building Umbraco MCP servers using the `@umbraco-cms/mcp-server-sdk`.

## Quick Start

Add the marketplace:
```bash
/plugin marketplace add umbraco/Umbraco-MCP-Base
```

Install the plugin:
```bash
/plugin install umbraco-mcp-skills@umbraco/Umbraco-MCP-Base
```

## Available Skills

### Agents

| Agent | Command | Purpose |
|-------|---------|---------|
| **mcp-tool-creator** | - | Creates MCP tools following toolkit patterns |
| **mcp-tool-description-writer** | - | Writes effective tool descriptions |
| **test-builder-helper-creator** | - | Creates test builders and helpers |
| **integration-test-creator** | - | Creates integration tests for tools |
| **integration-test-validator** | - | Validates test quality and patterns |
| **eval-test-creator** | - | Creates eval/acceptance tests |

### Knowledge Skills

| Skill | Command | Purpose |
|-------|---------|---------|
| **mcp-patterns** | `/mcp-patterns` | Load MCP development patterns |
| **mcp-testing** | `/mcp-testing` | Load testing patterns |

## Usage Examples

### Creating a New Tool

```
I need to create a new MCP tool for managing users.
```

Claude will automatically use the `mcp-tool-creator` agent to:
1. Design the tool following toolkit patterns
2. Use proper helper functions (`executeGetApiCall`, etc.)
3. Add correct annotations and slices
4. Export with `withStandardDecorators`

### Writing Tests

```
Create integration tests for the user management tools.
```

Claude uses `integration-test-creator` to:
1. Set up test infrastructure
2. Create tests following patterns
3. Run and verify tests pass
4. Call `integration-test-validator` for QA

### Loading Knowledge

```
/mcp-patterns
```

Loads comprehensive reference for:
- Tool definition patterns
- Helper function usage
- Project structure
- Best practices

## Toolkit Integration

This plugin is designed for projects using `@umbraco-cms/mcp-server-sdk`:

```typescript
import {
  configureApiClient,
  executeGetApiCall,
  executeVoidApiCall,
  createToolResult,
  withStandardDecorators,
  CAPTURE_RAW_HTTP_RESPONSE,
} from "@umbraco-cms/mcp-server-sdk";
```

## Project Structure Expected

```
src/
├── api/
│   ├── client.ts
│   ├── openapi.yaml
│   └── generated/
├── tools/
│   └── {entity}/
│       ├── get/
│       ├── post/
│       └── index.ts
├── __tests__/
└── __evals__/
```

## Agents in Detail

### mcp-tool-creator

Creates tools using the correct patterns:

```typescript
const MyTool = {
  name: "my-tool",
  description: "...",
  inputSchema: schema.shape,
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    return executeGetApiCall((client) =>
      client.method(params, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
} satisfies ToolDefinition<...>;

export default withStandardDecorators(MyTool);
```

### integration-test-creator

Creates tests following the pattern:

```typescript
import { setupTestEnvironment, createMockRequestHandlerExtra } from "@umbraco-cms/mcp-server-sdk/testing";

describe("my-tool", () => {
  setupTestEnvironment();

  it("should work", async () => {
    const result = await myTool.handler(
      { param: "value" },
      createMockRequestHandlerExtra()
    );
    expect(result.structuredContent).toBeDefined();
  });
});
```

### eval-test-creator

Creates LLM-based acceptance tests:

```typescript
import { runScenarioTest } from "@umbraco-cms/mcp-server-sdk/evals";

it("should complete workflow",
  runScenarioTest({
    prompt: "Create an item, then delete it...",
    tools: ["create-item", "delete-item"],
    requiredTools: ["create-item", "delete-item"],
    successPattern: "completed successfully",
  }),
  60000
);
```

## License

MIT
