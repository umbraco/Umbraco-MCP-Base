# @umbraco-cms/mcp-toolkit

Umbraco-specific MCP infrastructure and patterns for building MCP servers that expose Umbraco APIs.

## Installation

```bash
npm install @umbraco-cms/mcp-toolkit
```

## Overview

This toolkit provides reusable infrastructure for building MCP (Model Context Protocol) servers that expose Umbraco APIs to AI assistants. It includes:

- **Tool result formatting** - Standardized response formatting with ProblemDetails error handling
- **Tool decorators** - Error handling, validation, and composition patterns
- **API call helpers** - Simplified API execution with automatic error handling
- **Configuration** - Collection and slice-based tool filtering with mode presets
- **Testing utilities** - Snapshot normalization and test environment setup
- **Eval testing** - LLM-based acceptance testing using Claude Agent SDK
- **Type definitions** - ToolDefinition, ToolCollectionExport, and configuration types

## Quick Start

### 1. Configure the API Client

At application startup, configure the API client provider:

```typescript
import { configureApiClient } from '@umbraco-cms/mcp-toolkit';
import { MyApiClient } from './api/client.js';

configureApiClient(() => MyApiClient.getClient());
```

### 2. Create Tools

```typescript
import { z } from 'zod';
import {
  withStandardDecorators,
  executeGetApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from '@umbraco-cms/mcp-toolkit';

const inputSchema = {
  id: z.string().uuid().describe('The item ID'),
};

const getItemTool: ToolDefinition<typeof inputSchema> = {
  name: 'get-item',
  description: 'Gets an item by ID',
  inputSchema,
  slices: ['read'],
  annotations: {
    readOnlyHint: true,
  },
  handler: async ({ id }) => {
    return executeGetApiCall((client) =>
      client.getItemById(id, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(getItemTool);
```

### 3. Create Tool Collections

```typescript
import { ToolCollectionExport } from '@umbraco-cms/mcp-toolkit';
import getItemTool from './get/get-item.js';
import createItemTool from './post/create-item.js';

const collection: ToolCollectionExport = {
  metadata: {
    name: 'item',
    displayName: 'Item Tools',
    description: 'Tools for managing items',
  },
  tools: (user) => [
    getItemTool,
    createItemTool,
  ],
};

export default collection;
```

## API Reference

### Tool Helpers

#### `createToolResult(structuredContent?, includeStructured?, content?)`

Creates a standardized MCP tool result with structured content.

```typescript
import { createToolResult } from '@umbraco-cms/mcp-toolkit';

// Success response with data
return createToolResult({ name: 'Test', id: '123' });

// Success without structured content
return createToolResult(undefined, false);

// With additional text content
return createToolResult({ id: '123' }, true, [{ type: 'text', text: 'Created' }]);
```

#### `createToolResultError(errorData)`

Creates an error tool result with ProblemDetails format.

```typescript
import { createToolResultError } from '@umbraco-cms/mcp-toolkit';

return createToolResultError({
  status: 404,
  title: 'Not Found',
  detail: 'The requested item was not found'
});
```

### API Call Helpers

**Important:** Always pass `CAPTURE_RAW_HTTP_RESPONSE` to API calls to ensure proper error handling.

#### `executeGetApiCall(apiCall)`

Executes a GET API call with automatic error handling.

```typescript
import { executeGetApiCall, CAPTURE_RAW_HTTP_RESPONSE } from '@umbraco-cms/mcp-toolkit';

return executeGetApiCall((client) =>
  client.getDataTypeById(id, CAPTURE_RAW_HTTP_RESPONSE)
);
```

#### `executeVoidApiCall(apiCall)`

Executes a void API call (DELETE, PUT without response body).

```typescript
import { executeVoidApiCall, CAPTURE_RAW_HTTP_RESPONSE } from '@umbraco-cms/mcp-toolkit';

return executeVoidApiCall((client) =>
  client.deleteDataTypeById(id, CAPTURE_RAW_HTTP_RESPONSE)
);
```

#### `executeGetItemsApiCall(apiCall)`

Executes a GET API call and wraps the result as `{ items: data }`.

```typescript
import { executeGetItemsApiCall, CAPTURE_RAW_HTTP_RESPONSE } from '@umbraco-cms/mcp-toolkit';

return executeGetItemsApiCall((client) =>
  client.getTreeAncestors(params, CAPTURE_RAW_HTTP_RESPONSE)
);
```

### Tool Decorators

#### `withStandardDecorators(tool)`

Applies all standard decorators: error handling and pre-execution checks.

```typescript
import { withStandardDecorators } from '@umbraco-cms/mcp-toolkit';

export default withStandardDecorators({
  name: 'my-tool',
  description: 'My tool description',
  inputSchema: { /* ... */ },
  slices: ['read'],
  handler: async (params) => { /* ... */ }
});
```

#### `withErrorHandling(tool)`

Wraps a tool with standardized error handling. Catches errors and converts them to ProblemDetails format.

#### `configurePreExecutionHook(hook)`

Configure a custom pre-execution hook (e.g., for version checking).

```typescript
import { configurePreExecutionHook } from '@umbraco-cms/mcp-toolkit';

configurePreExecutionHook(() => {
  if (versionMismatch) {
    return {
      blocked: true,
      message: 'Version mismatch detected',
      clearAfterUse: () => clearWarning()
    };
  }
  return undefined;
});
```

### Validation Errors

#### `ToolValidationError`

Custom error class for business logic validation errors.

```typescript
import { ToolValidationError } from '@umbraco-cms/mcp-toolkit';

throw new ToolValidationError({
  title: 'Invalid Input',
  detail: 'Name cannot be empty',
  extensions: {
    field: 'name'
  }
});
```

### Types

#### `ToolDefinition<InputArgs, OutputArgs, TUser>`

Core tool definition interface.

```typescript
interface ToolDefinition<InputArgs, OutputArgs, TUser> {
  name: string;
  description: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  handler: ToolCallback<InputArgs>;
  enabled?: (user: TUser) => boolean;
  slices: ToolSliceName[];
  annotations?: Partial<ToolAnnotations>;
}
```

#### `ToolCollectionExport`

Interface for tool collection modules.

```typescript
interface ToolCollectionExport {
  metadata: ToolCollectionMetadata;
  tools: (user: UserModel) => ToolDefinition<any, any>[];
}
```

#### `ToolSliceName`

Valid slice names for tool categorization:
- CRUD: `'create'`, `'read'`, `'update'`, `'delete'`
- Navigation: `'tree'`, `'folders'`
- Query: `'search'`, `'list'`, `'references'`
- Workflow: `'publish'`, `'recycle-bin'`, `'move'`, `'copy'`, `'sort'`, `'validate'`, `'rename'`
- And more...

### Configuration

#### `createCollectionConfigLoader(options)`

Creates a configuration loader for collection-based tool filtering.

```typescript
import { createCollectionConfigLoader, ToolModeDefinition } from '@umbraco-cms/mcp-toolkit';

const modes: ToolModeDefinition[] = [
  {
    name: 'content',
    displayName: 'Content Management',
    description: 'Document creation and editing',
    collections: ['document', 'document-version']
  }
];

const loader = createCollectionConfigLoader({
  modeRegistry: modes,
  allModeNames: modes.map(m => m.name)
});

const config = loader.loadFromConfig(serverConfig);
```

## Testing Utilities

Import from `@umbraco-cms/mcp-toolkit/testing`:

```typescript
import {
  setupTestEnvironment,
  createSnapshotResult,
  createMockRequestHandlerExtra,
  BLANK_UUID,
} from '@umbraco-cms/mcp-toolkit/testing';

describe('my-tool', () => {
  // Handles console.error mocking
  setupTestEnvironment();

  it('should return data', async () => {
    const context = createMockRequestHandlerExtra();
    const result = await myTool.handler({ id: BLANK_UUID }, context);

    // Normalizes IDs and dates for snapshot testing
    expect(createSnapshotResult(result)).toMatchSnapshot();
  });
});
```

### Testing Helpers

- `setupTestEnvironment()` - Sets up and tears down test environment
- `createSnapshotResult(result, id?)` - Normalizes IDs and dates for snapshots
- `createMockRequestHandlerExtra()` - Creates mock request handler context
- `BLANK_UUID` - Constant for normalized UUID in snapshots
- `normalizeObject(obj, id?)` - Normalizes a single object
- `normalizeErrorResponse(obj, id?)` - Normalizes error responses

## Eval Testing

For LLM-based acceptance testing using Claude Agent SDK.

Import from `@umbraco-cms/mcp-toolkit/evals`:

```typescript
import {
  configureEvals,
  runScenarioTest,
  verifyRequiredToolCalls,
} from '@umbraco-cms/mcp-toolkit/evals';

// Configure before tests
configureEvals({
  mcpServerPath: 'dist/index.js',
  mcpServerName: 'my-mcp-server',
  serverEnv: {
    API_KEY: process.env.API_KEY || '',
    BASE_URL: process.env.BASE_URL || ''
  }
});

describe('integration tests', () => {
  it('should complete workflow',
    runScenarioTest({
      prompt: 'Create an item called _Test, then delete it',
      tools: ['create-item', 'delete-item'],
      requiredTools: ['create-item', 'delete-item'],
      timeout: 120000
    }),
    120000
  );
});
```

### Eval Configuration Options

```typescript
interface EvalConfig {
  mcpServerPath: string;      // Path to MCP server entry point
  mcpServerName: string;      // Name for MCP client
  serverEnv: Record<string, string>;  // Environment variables
  defaultModel?: string;      // Claude model (default: 'claude-sonnet-4-20250514')
  defaultTimeout?: number;    // Test timeout in ms
  verbose?: boolean;          // Enable verbose logging
}
```

## Subpath Exports

The toolkit provides several subpath exports for tree-shaking:

- `@umbraco-cms/mcp-toolkit` - Main exports
- `@umbraco-cms/mcp-toolkit/testing` - Testing utilities
- `@umbraco-cms/mcp-toolkit/evals` - Eval testing framework
- `@umbraco-cms/mcp-toolkit/config` - Configuration utilities
- `@umbraco-cms/mcp-toolkit/helpers` - Helper functions
- `@umbraco-cms/mcp-toolkit/types` - Type definitions

## Requirements

- Node.js >= 22.0.0
- TypeScript >= 5.0
- `@anthropic-ai/claude-agent-sdk` (optional, for eval testing)

## License

MIT
