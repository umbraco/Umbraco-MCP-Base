# Tool Authoring Guide

How tools work in `@umbraco-cms/mcp-server-sdk` and how to add your own.

## How the System Works

```
Entry point (src/index.ts)
  → loads server config (env vars, CLI flags)
  → imports tool collections
  → filters tools (modes → collections → slices → individual tools)
  → registers surviving tools with MCP server
  → on tool call: handler invoked → result returned to LLM
```

**Collections** group related tools with metadata (name, description, dependencies). Each collection exports a `tools()` function returning an array of `ToolDefinition` objects. The entry point iterates collections, filters each tool, and registers it with the MCP server.

## Adding a New Collection

### 1. Create the directory structure

```
src/umbraco-api/tools/my-feature/
├── index.ts              # Collection export
├── get/
│   ├── get-item.ts       # Read tool
│   └── list-items.ts     # List tool
├── post/
│   └── create-item.ts    # Create tool
├── put/
│   └── update-item.ts    # Update tool
└── delete/
    └── delete-item.ts    # Delete tool
```

### 2. Create the collection index

```typescript
// src/umbraco-api/tools/my-feature/index.ts
import { ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import getItemTool from "./get/get-item.js";
import listItemsTool from "./get/list-items.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "my-feature",           // Used in filtering config
    displayName: "My Feature",
    description: "Tools for managing my feature",
    dependencies: ["document"],   // Optional: other collections this depends on
  },
  tools: () => [getItemTool, listItemsTool],
};

export default collection;
```

The `tools` property is a function `(user) => ToolDefinition[]`. Pass user context to gate tools per-user, or call with `{}` for admin-level access.

### 3. Register in the entry point

```typescript
// src/index.ts
import myFeatureCollection from "./umbraco-api/tools/my-feature/index.js";

const collections = [
  // ...existing collections
  myFeatureCollection,
];
```

### 4. Optionally add to mode/slice registries

If your project uses modes (named groups of collections), add the collection to the relevant mode in your registry file.

## Adding a New Tool

### ToolDefinition Shape

```typescript
interface ToolDefinition<InputArgs, OutputArgs, TUser> {
  name: string;                    // Unique tool name (kebab-case)
  description: string;             // LLM-facing description
  inputSchema?: ZodRawShape;       // Input parameters (Zod shape, not ZodObject)
  outputSchema?: ZodType;          // Output schema (Zod object, array, or primitive)
  slices: string[];                // Filter categories: "read", "create", "update", "delete", "list"
  annotations?: {
    readOnlyHint?: boolean;        // Tool doesn't modify anything
    destructiveHint?: boolean;     // Tool may delete/destroy data
    idempotentHint?: boolean;      // Multiple calls = same effect
    openWorldHint: boolean;        // Always true (interacts with external API)
  };
  enabled?: (user: TUser) => boolean;  // Per-user gating (optional)
  handler: (args, extra) => Promise<CallToolResult>;
}
```

**Key points:**
- `inputSchema` is a Zod **shape** (plain object of Zod types), not a `z.object()` — the SDK wraps it
- `slices` controls filtering. Empty array `[]` means the tool is always included regardless of slice filters
- `annotations.openWorldHint` is always `true` for Umbraco API tools

### Always Wrap with `withStandardDecorators`

Every tool should be wrapped before export:

```typescript
export default withStandardDecorators(myTool);
```

This applies (in order):
1. **Pre-execution check** — runs any configured hook before the handler
2. **Error handling** — catches errors and converts them to proper MCP error results

Error handling priority: `ToolValidationError` → `UmbracoApiError` → Axios errors → standard `Error` → unknown.

### Result Helpers

```typescript
import { createToolResult, createToolResultError } from "@umbraco-cms/mcp-server-sdk";

// Success — data goes to both structuredContent and text content
createToolResult({ id: "abc", name: "Item" });

// Success — with custom text content
createToolResult({ id: "abc" }, true, [{ type: "text", text: "Created item abc" }]);

// Error — sets isError: true
createToolResultError({ title: "Not Found", detail: "Item does not exist" });
```

### Validation Errors

For business logic validation (not API errors), throw `ToolValidationError`:

```typescript
import { ToolValidationError } from "@umbraco-cms/mcp-server-sdk";

if (name.startsWith("_reserved_")) {
  throw new ToolValidationError({
    title: "Invalid Name",
    detail: "Names starting with '_reserved_' are not allowed",
    extensions: { invalidName: name },
  });
}
```

## Examples

### Simple GET Tool

```typescript
import {
  withStandardDecorators,
  executeGetApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import { z } from "zod";

const inputSchema = {
  id: z.string().uuid().describe("The item ID"),
};

const outputSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const getItemTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "get-item",
  description: "Gets an item by ID.",
  inputSchema,
  outputSchema,
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async ({ id }) => {
    return executeGetApiCall<any, MyApiClient>(
      (client) => client.getItem(id, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(getItemTool);
```

### Void API Call (Delete)

```typescript
import {
  withStandardDecorators,
  executeVoidApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import { z } from "zod";

const inputSchema = {
  id: z.string().uuid().describe("The item ID to delete"),
};

const deleteItemTool: ToolDefinition<typeof inputSchema> = {
  name: "delete-item",
  description: "Deletes an item by ID.",
  inputSchema,
  slices: ["delete"],
  annotations: { destructiveHint: true },
  handler: async ({ id }) => {
    return executeVoidApiCall<MyApiClient>(
      (client) => client.deleteItem(id, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(deleteItemTool);
```

### Manual API Call with Custom Response

Use manual handling when you need to extract headers, handle non-standard status codes, or build custom responses:

```typescript
import {
  withStandardDecorators,
  createToolResult,
  UmbracoApiError,
  CAPTURE_RAW_HTTP_RESPONSE,
  getApiClient,
  ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import { z } from "zod";

const inputSchema = {
  name: z.string().min(1).describe("Item name"),
  description: z.string().nullish().describe("Optional description"),
};

const outputSchema = z.object({
  success: z.boolean(),
  id: z.string().optional(),
  location: z.string().optional(),
});

const createItemTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "create-item",
  description: "Creates a new item.",
  inputSchema,
  outputSchema,
  slices: ["create"],
  annotations: { destructiveHint: false, idempotentHint: false },
  handler: async ({ name, description }) => {
    const client = getApiClient<MyApiClient>();
    const response = await client.createItem(
      { name, description },
      CAPTURE_RAW_HTTP_RESPONSE
    );

    if (response.status !== 201) {
      throw new UmbracoApiError(response.data || {
        status: response.status,
        detail: response.statusText,
      });
    }

    const location = response.headers?.location;
    const id = location?.split("/").pop();

    return createToolResult({ success: true, id, location });
  },
};

export default withStandardDecorators(createItemTool);
```

## Reference

| Source File | Contains |
|-------------|----------|
| `src/types/tool-definition.ts` | `ToolDefinition`, `ToolAnnotations`, `UserModel`, `baseSliceNames` |
| `src/types/tool-collection.ts` | `ToolCollectionExport`, `ToolCollectionMetadata` |
| `src/helpers/tool-result.ts` | `createToolResult`, `createToolResultError` |
| `src/helpers/decorators.ts` | `withStandardDecorators`, `withErrorHandling`, `withPreExecutionCheck`, `compose` |
| `src/helpers/api-call-helpers.ts` | `executeGetApiCall`, `executeVoidApiCall`, `CAPTURE_RAW_HTTP_RESPONSE` |
