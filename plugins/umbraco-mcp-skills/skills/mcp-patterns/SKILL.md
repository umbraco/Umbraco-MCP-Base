---
name: mcp-patterns
description: Load MCP development patterns and best practices for building tools with the @umbraco-cms/mcp-server-sdk. Use when starting tool development or needing pattern reference.
---

# MCP Development Patterns

This skill loads comprehensive patterns for building MCP tools using the `@umbraco-cms/mcp-server-sdk`.

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
} from "@umbraco-cms/mcp-server-sdk";

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
import { configureApiClient } from "@umbraco-cms/mcp-server-sdk";
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

## Schema Flattening for Nested Reference Objects

Umbraco APIs wrap references to other entities in a nested object — most commonly `parent`:

```json
{ "name": "My Folder", "parent": { "id": "3f2a…" } }
```

Never expose that shape to the LLM. **Accept a flat scalar and rebuild the nested object inside the handler.**

### Why

- **LLMs stringify nested JSON.** Models frequently emit a nested object as a JSON *string*
  (`"parent": "{\"id\":\"3f2a…\"}"`) instead of a real object. Zod rejects it, the tool call
  fails, and the model has no useful signal about how to fix it.
- **Optional-vs-null is ambiguous.** "Omit `parent` to create at root" is far clearer to a
  model than "pass `parent: null`, or `{ id }`, but never `{}`".
- **One fewer nesting level = fewer tokens and fewer retries.**

### Pattern

```typescript
import {
  withStandardDecorators,
  createToolResult,
  getApiClient,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
  type HttpResponse,
} from "@umbraco-cms/mcp-server-sdk";
import type { getYourAPI } from "../../../api/generated/yourApi.js";
import { z } from "zod";

type ApiClient = ReturnType<typeof getYourAPI>;

// Flat scalar in, nested object out — the LLM never sees `parent`
const inputSchema = {
  name: z.string().min(1).describe("Name of the folder to create"),
  parentId: z
    .uuid()
    .optional()
    .describe("ID of the parent folder. Omit to create the folder at the root."),
};

const outputSchema = z.object({
  success: z.boolean(),
  id: z.string().optional(),
});

const CreateFolderTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "create-folder",
  description: "Creates a folder, optionally beneath a parent folder.",
  inputSchema,
  outputSchema,
  slices: ["create"],
  annotations: { destructiveHint: false, idempotentHint: false },
  handler: async ({ name, parentId }) => {
    // Rebuild the API's nested shape here
    const payload = {
      name,
      parent: parentId ? { id: parentId } : null,
    };

    const client = getApiClient<ApiClient>();
    const response = (await client.postFolder(
      payload,
      CAPTURE_RAW_HTTP_RESPONSE,
    )) as HttpResponse;

    // ... standard POST handling: check status, read Location, createToolResult
  },
};

export default withStandardDecorators(CreateFolderTool);
```

The same transform applies to PUT (`executeVoidApiCall`) — build `payload` first, then pass it to
the client method.

Path-based APIs (scripts, stylesheets, partial views) use the same wrapper keyed on `path`:
accept a flat `path` and transform to `parent: { path }`.

### When to apply

| API request shape | Expose to the LLM as | Handler rebuilds |
|---|---|---|
| `parent: { id } \| null` | `parentId?: string` | `parent: parentId ? { id: parentId } : null` |
| `parent: { path } \| null` | `path?: string` | `parent: path ? { path } : null` |
| Any single-key reference wrapper (`target: { id }`, `destination: { id }`) | `targetId`, `destinationId` | rebuild the wrapper |
| Nested object with 2–3 meaningful fields | flat sibling fields | rebuild the object |
| Deeply nested arrays of objects (content `values`/`variants`) | **don't flatten** — keep the generated schema | — |

For the last row, flattening loses information. If the model still can't fill the schema
reliably, the answer is a narrower composite tool, not a flatter schema.

### Rules

1. **Name the flat field after both keys** — `parentId`, not `parent` or `id`. An unqualified
   `id` on a create tool reads like "the ID of the thing being created".
2. **Document the omitted case in the description** — "Omit to create at the root."
3. **Flattening means you hand-write the input schema.** You can no longer pass the Orval
   `*.zod.ts` request schema through verbatim; derive it (`generatedSchema.omit({ parent: true }).extend({ parentId: … })`)
   or declare the shape by hand, and keep the payload typed against the client method.
4. **Always test with the parent param supplied.** A create tool exercised only at root hides a
   broken transform — the API happily accepts `parent: null`. Every tool with a flattened
   reference needs at least one integration test that passes it and asserts the entity landed
   under that parent.

## Project Structure

```
src/
├── api/
│   ├── client.ts           # API client with mock support
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
- Generates TypeScript client (configurable via `client` option)
- Generates Zod schemas for validation
- Uses custom mutator for authentication

## Best Practices

1. **Use Zod schemas** from generated code for type safety
2. **Hide UUID generation** - create internally, don't expect LLM to provide
3. **Clear descriptions** - tools should be self-documenting
4. **Consistent naming** - follow `{action}-{entity}` pattern
5. **Error handling** - `withStandardDecorators` handles errors automatically
6. **Flatten nested reference objects** - accept `parentId` / `path`, rebuild `parent: { id }` /
   `parent: { path }` in the handler (see [Schema Flattening](#schema-flattening-for-nested-reference-objects))
