---
name: build-tools
description: Build MCP tool collections from discovered API groups. Reads .discover.json and generates tools and collection registrations. Use after running 'npx create-umbraco-mcp-server discover'.
user_invocable: true
---

# Build Tools

Generate MCP tool collections from the API groups selected during discovery. This skill reads `.discover.json` and the swagger spec, then builds tool files one collection at a time.

**IMPORTANT: This skill ONLY creates tool files, collection indexes, and registrations. Do NOT create any test files, test setup, test builders, test helpers, or `__tests__/` directories. Testing is handled separately by the `/build-tools-tests` skill.**

## Prerequisites

Before running, ensure:
1. You have run `npx create-umbraco-mcp-server discover` (`.discover.json` exists)
2. The API client has been generated (`src/umbraco-api/api/generated/` directory exists — if not, run `npm run generate`)

## Arguments

- No arguments: build all collections from `.discover.json`
- Single collection name: build only that collection (e.g. `/build-tools form`)

## Agents

This skill orchestrates the following agents — use them for the relevant steps:

| Agent | When to use |
|-------|-------------|
| `mcp-tool-creator` | Creating each tool file (Step 3b) |
| `mcp-tool-description-writer` | Writing tool descriptions (Step 3b) |
| `mcp-tool-reviewer` | Reviewing tools for LLM-readiness (Step 4) |

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

### Step 1: Check Generated Client

Check if `src/umbraco-api/api/generated/` exists and contains `.ts` files. If not, run:

```bash
npm run generate
```

Then read the generated files to understand:
- The API client function name (e.g. `getFormsManagementAPI`)
- The available Zod schemas (in `*.zod.ts` files)
- The available client methods and their signatures

### Step 2: Read Swagger Spec

Fetch the swagger spec from the `swaggerUrl` in `.discover.json` using curl:

```bash
curl -sk {swaggerUrl}
```

For each collection, find operations where `tags[0]` matches the collection's original tag name (the tag before kebab-case conversion). Collect:
- HTTP method
- Path
- operationId
- Summary
- Parameters and request body schema
- Response schema

### Step 3: Per Collection — Create Tools

For each collection, **skip if `src/umbraco-api/tools/{collection}/index.ts` already exists**.

#### 3a. Create directory structure

```
src/umbraco-api/tools/{collection}/
├── get/
├── post/
├── put/
└── delete/
```

Not every directory is needed — only create subdirectories for HTTP methods that have operations.

#### 3b. Create tool files

Create one file per operation. Map operations to files:

| HTTP Method | File pattern | Slice | Annotations |
|-------------|-------------|-------|-------------|
| GET (single item by ID) | `get/get-{entity}.ts` | `read` | `readOnlyHint: true` |
| GET (list/collection) | `get/list-{entities}.ts` | `list` | `readOnlyHint: true` |
| GET (search) | `get/search-{entities}.ts` | `search` | `readOnlyHint: true` |
| POST | `post/create-{entity}.ts` | `create` | `destructiveHint: false, idempotentHint: false` |
| PUT/PATCH | `put/update-{entity}.ts` | `update` | `idempotentHint: true` |
| DELETE | `delete/delete-{entity}.ts` | `delete` | `destructiveHint: true` |

Each tool file follows this pattern:

```typescript
import {
  withStandardDecorators,
  executeGetApiCall,     // GET operations
  executeVoidApiCall,    // DELETE/PUT operations
  createToolResult,      // POST operations (manual handling)
  getApiClient,          // POST operations (manual handling)
  UmbracoApiError,       // POST operations (manual handling)
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { getYourAPI } from "../../../api/generated/yourApi.js";
import { inputSchema, outputSchema } from "../../../api/generated/yourApi.zod.js";

type ApiClient = ReturnType<typeof getYourAPI>;

const tool: ToolDefinition<typeof inputSchema.shape, typeof outputSchema> = {
  name: "action-entity",
  description: "Clear description starting with action verb.",
  inputSchema: inputSchema.shape,
  outputSchema,
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    return executeGetApiCall<ReturnType<ApiClient["method"]>, ApiClient>(
      (client) => client.method(params, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(tool);
```

**Key rules:**
- Use Zod schemas from the generated `*.zod.ts` files for input/output
- For POST/create: use manual handling with `getApiClient`, extract ID from Location header
- For DELETE/PUT: use `executeVoidApiCall`
- For GET: use `executeGetApiCall`
- Never require UUIDs from the LLM — generate them server-side
- Keep input schemas to 3-5 fields max — hide complexity
- Write descriptions as mini-prompts: what it does, key constraints, when to use

#### 3c. Create collection index.ts

```typescript
import { ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import getTool from "./get/get-entity.js";
import listTool from "./get/list-entities.js";
// ... other imports

const collection: ToolCollectionExport = {
  metadata: {
    name: "{collection-name}",
    displayName: "{Display Name} Tools",
    description: "Tools for managing {entity} resources",
  },
  tools: () => [getTool, listTool, /* ... */],
};

export default collection;
```

#### 3d. Register collection

Add the collection import and registration to `src/index.ts`:

1. Add an import at the top with the other collection imports:
   ```typescript
   import {collection}Collection from "./tools/{collection}/index.js";
   ```

2. Add it to the `collections` array:
   ```typescript
   const collections = [existingCollection, {collection}Collection];
   ```

#### 3e. Compile

```bash
npm run compile
```

Fix any TypeScript errors before proceeding. Common issues:
- Wrong import paths to generated client
- Mismatched Zod schema shapes
- Missing `CAPTURE_RAW_HTTP_RESPONSE` parameter

### Step 4: Per Collection — Review with `mcp-tool-reviewer`

After all tools are created for a collection, run the `mcp-tool-reviewer` agent on the collection. The agent will check each tool against the LLM-readiness checklist:

- Schema simplification (max 3-5 fields, no nested objects, no UUID generation from LLM)
- Description quality (action verbs, constraints, when NOT to use)
- Response shaping (essential fields only, actionable errors)
- Composite tool opportunities (flag sequences that should be bundled)
- Naming & annotations (consistent, correct hints per HTTP method)
- Context & scope (no redundant tools, reasonable count)
- Pagination design (appropriate page sizes, documented mechanics)

Flag any issues but continue to the next collection. The user can address review findings afterwards.

### Step 5: Next Collection

Repeat steps 3-4 for the next collection in `.discover.json`.

### Step 6: Final Verification

After all collections are built:

```bash
npm run compile    # Full type check
```

Then run `/count-mcp-tools` to confirm all collections are covered. All collections from `.discover.json` should show tool count > 0. If any show "Not started", report which collections were missed.

Report what was generated:
- Number of collections created
- Number of tools per collection
- Any review issues found
- Any collections skipped (already existed)

Next step: Run `/build-tools-tests` to generate integration tests for the tool collections.
