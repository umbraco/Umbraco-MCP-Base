---
name: mcp-patterns
description: Load MCP development patterns and best practices for building tools with the @umbraco-cms/mcp-toolkit. Use when starting tool development or needing pattern reference.
---

# MCP Development Patterns

This skill loads comprehensive patterns for building MCP tools using the `@umbraco-cms/mcp-toolkit`.

## When to Use

Use this skill when:
- Starting to create new MCP tools
- Needing a reference for tool patterns
- Understanding how to use the toolkit helpers
- Setting up a new MCP server project

## Core Architecture

### Tool Definition Pattern

All tools follow this structure:

```typescript
import {
  withStandardDecorators,
  executeGetApiCall,
  executeVoidApiCall,
  createToolResult,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-toolkit";

const MyTool = {
  name: "tool-name",
  description: "What the tool does",
  inputSchema: zodSchema.shape,
  outputSchema: responseSchema,  // For GET operations
  slices: ["read"],              // Categorization
  annotations: {
    readOnlyHint: true,          // For GET
    destructiveHint: true,       // For DELETE
    idempotentHint: true,        // For PUT
  },
  handler: async (params) => {
    // Implementation
  },
} satisfies ToolDefinition<...>;

export default withStandardDecorators(MyTool);
```

### API Client Configuration

Configure once at server startup:

```typescript
import { configureApiClient } from "@umbraco-cms/mcp-toolkit";
import { getMyAPI } from "./api/generated/myApi.js";

configureApiClient(() => getMyAPI());
```

## Helper Functions

### executeGetApiCall
For GET operations that return data:
```typescript
return executeGetApiCall<ReturnType<Client["method"]>, Client>(
  (client) => client.method(params, CAPTURE_RAW_HTTP_RESPONSE)
);
```

### executeVoidApiCall
For DELETE/PUT operations that return void:
```typescript
return executeVoidApiCall<Client>(
  (client) => client.deleteItem(id, CAPTURE_RAW_HTTP_RESPONSE)
);
```

### createToolResult / createToolResultError
For custom responses (typically CREATE operations):
```typescript
if (response.status === 201) {
  return createToolResult({ success: true, id: extractedId });
} else {
  return createToolResultError(response.data);
}
```

## Slices (Tool Categorization)

Tools are categorized by operation type:
- `read` - GET operations
- `create` - POST create operations
- `update` - PUT operations
- `delete` - DELETE operations
- `search` - Search/filter operations

## Annotations Reference

| Operation | readOnlyHint | destructiveHint | idempotentHint |
|-----------|--------------|-----------------|----------------|
| GET       | ✅           | ❌              | ❌             |
| DELETE    | ❌           | ✅              | ❌             |
| POST      | ❌           | ❌              | ❌             |
| PUT       | ❌           | ❌              | ✅             |

**Important**: DELETE is NOT idempotent (2nd call returns 404).

## Project Structure

```
src/
├── api/
│   ├── client.ts           # Axios client with mock support
│   ├── openapi.yaml        # OpenAPI spec
│   └── generated/          # Orval-generated client + Zod schemas
├── tools/
│   └── {entity}/
│       ├── get/
│       ├── post/
│       ├── put/
│       ├── delete/
│       └── index.ts        # Collection export
└── index.ts                # MCP server entry
```

## Orval Code Generation

Generate client and Zod schemas from OpenAPI:
```bash
npm run generate
```

Configuration in `orval.config.ts`:
- Generates TypeScript client with Axios
- Generates Zod schemas for validation
- Uses custom mutator for authentication

## Best Practices

1. **Use Zod schemas** from generated code for type safety
2. **Hide UUID generation** - create internally, don't expect LLM to provide
3. **Clear descriptions** - tools should be self-documenting
4. **Consistent naming** - follow `{action}-{entity}` pattern
5. **Error handling** - `withStandardDecorators` handles errors automatically
