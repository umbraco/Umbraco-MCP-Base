# @umbraco-cms/mcp-server-sdk

Umbraco-specific MCP infrastructure and patterns for building MCP servers that expose Umbraco APIs.

## Installation

```bash
npm install @umbraco-cms/mcp-server-sdk
```

## Overview

This SDK provides reusable infrastructure for building MCP (Model Context Protocol) servers that expose Umbraco APIs to AI assistants. It includes:

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
import { configureApiClient } from '@umbraco-cms/mcp-server-sdk';
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
} from '@umbraco-cms/mcp-server-sdk';

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
import { ToolCollectionExport } from '@umbraco-cms/mcp-server-sdk';
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

### HTTP Client

The SDK provides a fetch-based client for the Umbraco Management API with OAuth authentication. Works in Node.js 22+ and Cloudflare Workers — no extra HTTP client dependency required.

#### `initializeUmbracoFetch(config)`

Initialize the HTTP client at application startup. Must be called before making API requests.

```typescript
import { initializeUmbracoFetch } from '@umbraco-cms/mcp-server-sdk';

initializeUmbracoFetch({
  baseUrl: 'https://localhost:44391',
  clientId: 'my-client-id',
  clientSecret: 'my-client-secret'
});
```

Features:
- Automatic OAuth token refresh
- Self-signed certificate support in development
- Repeat-style query string serialization for array params
- Error logging

#### `UmbracoManagementClient`

Orval mutator for generated API clients. Use with `client: "axios"` in your Orval config — the mutator accepts a config-object shape `{ url, method, params, data, headers }` and supports `returnFullResponse` for the SDK's `CAPTURE_RAW_HTTP_RESPONSE` helpers.

```typescript
// orval.config.ts
export default {
  myApi: {
    output: {
      client: 'axios',
      target: './src/api/client.ts',
      override: {
        mutator: {
          path: '@umbraco-cms/mcp-server-sdk',
          name: 'UmbracoManagementClient',
        }
      }
    }
  }
};
```

#### `createUmbracoFetchClient(options)`

Factory for creating isolated client instances (advanced use cases like testing or multiple Umbraco instances).

```typescript
import { createUmbracoFetchClient } from '@umbraco-cms/mcp-server-sdk';

const { mutator, initialize, clearToken } = createUmbracoFetchClient();
initialize({ baseUrl, clientId, clientSecret });
```

### Tool Helpers

#### `createToolResult(structuredContent?, includeStructured?, content?)`

Creates a standardized MCP tool result with structured content.

```typescript
import { createToolResult } from '@umbraco-cms/mcp-server-sdk';

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
import { createToolResultError } from '@umbraco-cms/mcp-server-sdk';

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
import { executeGetApiCall, CAPTURE_RAW_HTTP_RESPONSE } from '@umbraco-cms/mcp-server-sdk';

return executeGetApiCall((client) =>
  client.getDataTypeById(id, CAPTURE_RAW_HTTP_RESPONSE)
);
```

#### `executeVoidApiCall(apiCall)`

Executes a void API call (DELETE, PUT without response body).

```typescript
import { executeVoidApiCall, CAPTURE_RAW_HTTP_RESPONSE } from '@umbraco-cms/mcp-server-sdk';

return executeVoidApiCall((client) =>
  client.deleteDataTypeById(id, CAPTURE_RAW_HTTP_RESPONSE)
);
```

#### `executeGetItemsApiCall(apiCall)`

Executes a GET API call and wraps the result as `{ items: data }`.

```typescript
import { executeGetItemsApiCall, CAPTURE_RAW_HTTP_RESPONSE } from '@umbraco-cms/mcp-server-sdk';

return executeGetItemsApiCall((client) =>
  client.getTreeAncestors(params, CAPTURE_RAW_HTTP_RESPONSE)
);
```

### Tool Decorators

#### `withStandardDecorators(tool)`

Applies all standard decorators: error handling and pre-execution checks.

```typescript
import { withStandardDecorators } from '@umbraco-cms/mcp-server-sdk';

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
import { configurePreExecutionHook } from '@umbraco-cms/mcp-server-sdk';

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
import { ToolValidationError } from '@umbraco-cms/mcp-server-sdk';

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
  _meta?: Record<string, unknown>;
}
```

`_meta` is forwarded verbatim to the MCP `tools/list` entry, so host-specific
extensions reach the client. For example, ChatGPT's connector expects
`_meta: { "openai/fileParams": ["fieldName"] }` to know which top-level input
parameter is a user-attached file (and should be rewritten into a
`{ download_url, file_id, mime_type, file_name }` object on the way through).

```typescript
{
  name: "create-media-from-file",
  description: "...",
  inputSchema: { file: fileSchema, name: z.string(), mediaTypeName: z.string() },
  _meta: { "openai/fileParams": ["file"] },
  slices: ["create"],
  handler: async ({ file, name, mediaTypeName }) => { /* ... */ },
}
```

The `@umbraco-cms/mcp-hosted` registration loop forwards `_meta` when calling
`McpServer.registerTool`, so collection-resident tools see it on the wire
without any extra plumbing.

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
import { createCollectionConfigLoader, ToolModeDefinition } from '@umbraco-cms/mcp-server-sdk';

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

Import from `@umbraco-cms/mcp-server-sdk/testing`:

```typescript
import {
  setupTestEnvironment,
  createSnapshotResult,
  createMockRequestHandlerExtra,
  BLANK_UUID,
} from '@umbraco-cms/mcp-server-sdk/testing';

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

## MCP Chaining

Chain multiple MCP servers together, enabling internal delegation and tool proxying.

### Basic Usage

```typescript
import {
  createMcpClientManager,
  discoverProxiedTools,
  proxiedToolsToDefinitions,
} from '@umbraco-cms/mcp-server-sdk';

// Create manager with filter passthrough
const manager = createMcpClientManager({
  filterConfig: { slices: ['read', 'list'] }
});

// Register a chained MCP server
manager.registerServer({
  name: 'cms',
  command: 'npx',
  args: ['-y', '@umbraco-cms/mcp-dev'],
  env: {
    UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL,
    UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID,
    UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET,
  },
  proxyTools: true
});

// Internal delegation - call chained server tools programmatically
const result = await manager.callTool('cms', 'get-document', { id: '...' });

// Tool proxying - expose chained tools to parent client
const proxiedTools = await discoverProxiedTools(manager);
const toolDefinitions = proxiedToolsToDefinitions(proxiedTools, manager);
```

### Proxy Utilities

- `discoverProxiedTools(manager)` - Discover all tools from registered servers
- `isProxiedToolName(name)` - Check if a tool name is a proxied tool
- `parseProxiedToolName(name)` - Parse server and tool name from proxied name
- `createProxyHandler(manager)` - Create a handler for proxied tool calls
- `proxiedToolsToDefinitions(tools, manager)` - Convert to ToolDefinition array

## Version Check

Verify Umbraco server version compatibility at startup.

**`expectedUmbracoMajor` is required, and you should not hand-write it.** It is the Umbraco
major your server's tools were generated against, compared at startup against the connected
instance's major version. Because it is required, a server that omits it is a *compile error*
rather than a silently disabled check.

The value is discovered at generation time: `createUmbracoTargetMajorTransformer` (an orval
input transformer) resolves the target major during `npm run generate` and stamps it into a
generated constant, so regenerating against a newer Umbraco updates it automatically. See
[Deriving the target major](#deriving-the-target-major).

`mcpVersion` is accepted for logging/diagnostics but is **never** compared: an MCP server's own
package version has no relationship to the Umbraco major it targets (a scaffolded project
starts at `1.0.0`), so comparing against it falsely flagged every new project as incompatible
([#220](https://github.com/umbraco/Umbraco-MCP-Base/issues/220)).

`checkUmbracoVersion` computes the result and stores it in a singleton — on its own it does
nothing else observable besides logging to `stderr`. Two more calls are required to make the
warning actually reach the user: `configureVersionCheckHook()` bridges the singleton to
`withPreExecutionCheck` (applied to every tool via `withStandardDecorators`) so a mismatch
pauses tool execution until the user retries, and `getVersionCheckMessage()` lets you fold the
message into the server's `instructions` (or any other client-visible surface) so the
model/user sees it, not just the server log.

```typescript
import {
  checkUmbracoVersion,
  configureVersionCheckHook,
  getVersionCheckMessage,
  clearVersionCheckMessage,
  isToolExecutionBlocked,
} from '@umbraco-cms/mcp-server-sdk';

// The generated constant that `npm run generate` stamps out of the spec.
import { UMBRACO_TARGET_MAJOR } from './config/umbraco-target.generated.js';

// Check version at startup (this alone already logs a mismatch to stderr).
await checkUmbracoVersion({
  mcpVersion: '1.0.0', // diagnostics only — not compared
  // Required. The generated target, with an optional runtime override.
  expectedUmbracoMajor: process.env.UMBRACO_EXPECTED_MAJOR ?? UMBRACO_TARGET_MAJOR,
  client: {
    getServerInformation: async () => {
      const response = await api.getServerInformation();
      return { version: response.version };
    }
  }
});

// Bridge the result to withPreExecutionCheck so every tool call actually
// pauses on a mismatch (without this, isToolExecutionBlocked() is set but
// nothing consults it, and the "blocking" is dead code). Safe to call
// unconditionally — nothing is ever blocked when the versions match.
configureVersionCheckHook();

// Surface the message to the client, e.g. via server instructions:
// new McpServer({ name, version }, { instructions: getVersionCheckMessage() ?? undefined })
const message = getVersionCheckMessage();
if (message) {
  console.warn(message);
}

// Check if tools should be blocked
if (isToolExecutionBlocked()) {
  // Handle version mismatch
}

// Clear after user acknowledges (configureVersionCheckHook's hook also does
// this automatically the first time it blocks a tool call)
clearVersionCheckMessage();
```

### Deriving the target major

`createUmbracoTargetMajorTransformer` resolves the Umbraco major your tools target during
`npm run generate` and writes it to a committed TypeScript constant, so no human ever types it.

**It cannot come from the spec.** Every Umbraco Management API spec hard-codes `info.version` to
the literal string `"Latest"` — see `ConfigureUmbracoManagementApiSwaggerGenOptions` in Umbraco
CMS, verified on 15.x through 18.x — as does the shared `ConfigureUmbracoSwaggerGenOptions` that
add-ons (Forms, Commerce, Deploy, …) inherit. There is no version anywhere else in the document
and none in the response headers, so a spec-derived major only works for a committed spec file
that happens to carry a real semver.

Resolution order:

1. **`UMBRACO_GENERATE_TARGET_MAJOR`** environment variable. Always wins, even over `major`. The
   only knob here that needs no code edit — set it inline for a single invocation
   (`UMBRACO_GENERATE_TARGET_MAJOR=18 npm run generate`) to override every other source, e.g. for
   an offline/air-gapped CI job that must not patch a committed `orval.config.ts`. Named
   deliberately unlike the runtime `UMBRACO_EXPECTED_MAJOR` override: the two look similar but
   apply at different phases — this one affects what `npm run generate` stamps into the file,
   `UMBRACO_EXPECTED_MAJOR` affects what the running server checks the live instance against.
2. **`major`** passed to the transformer. Wins over the instance and the spec.
3. **The connected instance** — an authenticated `GET
   /umbraco/management/api/v1/server/information`, the only server endpoint that reports a real
   semver (`server/status` and `server/configuration` are anonymous but version-free). Uses
   `UMBRACO_BASE_URL` / `UMBRACO_CLIENT_ID` / `UMBRACO_CLIENT_SECRET` — the same values the
   server itself runs on, so the normal case needs no config at all. Set them for the
   `generate` invocation to point elsewhere; leave them unset to skip the lookup. The path is
   the same on every Umbraco major: the swagger → openapi rename at 18 moved the spec document
   URL, not the `/umbraco/management/api/v1/...` contract.
4. **The spec's `info.version`**, for a committed spec carrying a real semver.
5. Otherwise it **throws**, failing `npm run generate`.

Why an orval **input transformer** rather than a hook: orval's only lifecycle hook,
`afterAllFilesWrite`, receives written file paths and never sees the spec. An input transformer
receives the fully parsed OpenAPI document, so it works identically for a local YAML/JSON file
and a live Umbraco spec URL. Orval `await`s input transformers, so the same extension point can
do the authenticated lookup. It runs on every `orval` invocation, i.e. every `npm run generate`.

```typescript
// orval.config.ts
import 'dotenv/config'; // so UMBRACO_* from .env reach the transformer
import { defineConfig } from 'orval';
import {
  createUmbracoTargetMajorTransformer,
  relaxUntypedArrays,
} from '@umbraco-cms/mcp-server-sdk';

const stampTargetMajor = createUmbracoTargetMajorTransformer({
  outputPath: './src/config/umbraco-target.generated.ts', // resolved against cwd
  // major: '18',  // pin explicitly when the instance is unreachable
});

export default defineConfig({
  myApi: {
    input: {
      // Umbraco 18+: /umbraco/openapi/{name}.json
      // Umbraco 17 and earlier: /umbraco/swagger/{name}/swagger.json
      // Either is fine — the target major comes from the instance, not this URL.
      target: 'http://localhost:56472/umbraco/openapi/management.json',
      override: {
        // Transformers compose. stampTargetMajor returns the spec untouched —
        // it only writes the constant as a side effect. It is async; orval
        // awaits input transformers, so returning the promise is correct.
        transformer: (spec) => stampTargetMajor(relaxUntypedArrays(spec)),
      },
    },
    // ... output config
  },
});
```

Produces:

```typescript
// AUTO-GENERATED by @umbraco-cms/mcp-server-sdk's orval target-major transformer.
// Do not edit by hand — regenerate via `npm run generate`.
export const UMBRACO_TARGET_MAJOR = "18";
```

Notes:

- **Commit the generated file.** A freshly scaffolded project must have a working value before
  anyone runs `generate` themselves.
- **There is no "keep the previous value" fallback.** An unresolvable target major fails the
  build. `checkUmbracoVersion` *blocks* tool execution on a mismatch, so a stale constant is
  indistinguishable from the placeholder that shipped
  [#220](https://github.com/umbraco/Umbraco-MCP-Base/issues/220) — the earlier warn-and-keep
  behaviour meant a project regenerating against a new Umbraco major silently kept the old one.
- **Generating offline** (no reachable instance) needs an explicit `major`, or an `info.version`
  that carries a real Umbraco semver.
- Against a local Umbraco over HTTPS with a self-signed cert, the lookup needs
  `NODE_TLS_REJECT_UNAUTHORIZED=0` in `.env` — the same variable the server itself uses.
- If the instance lookup fails but the spec supplies a version, generation continues **with a
  warning** — an add-on's spec reports the add-on's own release, not Umbraco's, so the value
  needs a human eye.
- The generated file records which source the value came from, so a wrong one is diagnosable
  from the committed file alone.
- The file is only rewritten when the resolved value changes, so a no-op `npm run generate`
  leaves the working tree clean.
- `major` is the only option beyond `outputPath`/`constantName` — but `UMBRACO_GENERATE_TARGET_MAJOR`
  sits above it in precedence, so an env override always wins even when `major` is set. Credentials
  are environment-only by design: they are the same three variables the server already needs, and a
  second way to supply them would just be a second way to get them wrong.
- Related exports: `extractSpecMajor`, `renderTargetMajorModule`, `DEFAULT_TARGET_MAJOR_CONSTANT`,
  `SERVER_INFORMATION_PATH`, `TARGET_MAJOR_ENV_VAR`, `TargetMajorSource`.

### Wiring in scaffolded projects

`template/src/index.ts` shows the full wiring: it passes
`serverConfig.custom.expectedUmbracoMajor ?? UMBRACO_TARGET_MAJOR` into `checkUmbracoVersion`,
where `UMBRACO_TARGET_MAJOR` is the generated constant above (re-exported from
`template/src/config/index.ts`). `template/src/config/server-config.ts` exposes the override as
a custom config field so users can retarget without editing code:

| Env var | CLI flag | Effect |
|---------|----------|--------|
| `UMBRACO_EXPECTED_MAJOR` | `--umbraco-expected-major` | Overrides the generated `UMBRACO_TARGET_MAJOR` for a project deliberately pointed at a different Umbraco major. Unset (default) = use `UMBRACO_TARGET_MAJOR`. |

The template then calls `configureVersionCheckHook()` unconditionally — harmless when the
versions match, since nothing is blocked in that case.

`checkUmbracoVersion` degrades to a no-op (no request, no message, nothing blocked) if the
resolved major is blank — a runtime guard against a misconfigured `UMBRACO_EXPECTED_MAJOR=""`,
not a supported way to disable the check.

## Eval Testing

For LLM-based acceptance testing using Claude Agent SDK.

Import from `@umbraco-cms/mcp-server-sdk/evals`:

```typescript
import {
  configureEvals,
  runScenarioTest,
  verifyRequiredToolCalls,
} from '@umbraco-cms/mcp-server-sdk/evals';

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

## Server Configuration

Load server configuration from environment variables and CLI arguments.

```typescript
import { getServerConfig } from '@umbraco-cms/mcp-server-sdk';

const { config, errors, help } = getServerConfig({
  name: 'my-mcp-server',
  version: '1.0.0',
  fields: [
    { name: 'baseUrl', env: 'UMBRACO_BASE_URL', required: true, type: 'string' },
    { name: 'clientId', env: 'UMBRACO_CLIENT_ID', required: true, type: 'string' },
    { name: 'clientSecret', env: 'UMBRACO_CLIENT_SECRET', required: true, type: 'string', secret: true },
    { name: 'readonly', env: 'UMBRACO_READONLY', type: 'boolean', default: false },
  ]
});

if (help) {
  console.log(help);
  process.exit(0);
}

if (errors.length > 0) {
  console.error('Configuration errors:', errors);
  process.exit(1);
}

// config.baseUrl, config.clientId, etc. are now available
```

## Constants

Well-known Umbraco IDs for common operations.

```typescript
import {
  BLANK_UUID,
  FOLDER_MEDIA_TYPE_ID,
  IMAGE_MEDIA_TYPE_ID,
  FILE_MEDIA_TYPE_ID,
  STANDARD_MEDIA_TYPES,
} from '@umbraco-cms/mcp-server-sdk';

// Use in tool implementations
if (STANDARD_MEDIA_TYPES.includes(mediaTypeId)) {
  // Handle standard media type
}
```

Available constants:
- `BLANK_UUID` - Empty UUID for testing/snapshots
- Media type IDs: `FOLDER_MEDIA_TYPE_ID`, `IMAGE_MEDIA_TYPE_ID`, `FILE_MEDIA_TYPE_ID`, `VIDEO_MEDIA_TYPE_ID`, `AUDIO_MEDIA_TYPE_ID`, `ARTICLE_MEDIA_TYPE_ID`, `VECTOR_GRAPHICS_MEDIA_TYPE_ID`
- Data type IDs: `TextString_DATA_TYPE_ID`, `MEDIA_PICKER_DATA_TYPE_ID`, `MEMBER_PICKER_DATA_TYPE_ID`, `TAG_DATA_TYPE_ID`
- User group IDs: `TRANSLATORS_USER_GROUP_ID`, `WRITERS_USER_GROUP_ID`

## File Utilities

```typescript
import { detectFileExtensionFromBuffer } from '@umbraco-cms/mcp-server-sdk';

// Detect file extension from binary data
const extension = detectFileExtensionFromBuffer(buffer); // e.g., 'png', 'jpg', 'pdf'
```

## Confirmation Surfaces

Tools that need explicit user approval call `requestApproval` from their
handler. The SDK routes by host capability:

- **Terminal hosts** (Claude Code, MCP Inspector) advertise `elicitation`
  → user sees an Accept/Decline prompt; the boolean reflects their choice.
- **GUI hosts** (Claude.ai, Claude Desktop, ChatGPT) advertise no
  elicitation → `requestApproval` auto-accepts. These hosts render their
  own native per-tool permission dialog (showing the call + args) before
  the tool ever reaches the server, so that UI *is* the consent surface.

```typescript
import { requestApproval, setServerRef, createToolResult } from "@umbraco-cms/mcp-server-sdk";

// At server init:
setServerRef(server.server);

// In a tool handler:
handler: async ({ id }, extra) => {
  if (!await requestApproval(extra, `Unpublish content ${id}?`)) {
    return createToolResult({ message: "Cancelled" });
  }
  // ... proceed
};
```

Cross-host MCP App widget consent was prototyped and rejected (see the
spike in PR #112) — ChatGPT strips `structuredContent` from widget
notifications, Claude.ai doesn't reliably surface `updateModelContext`
to the model, and the LLM has the same protocol access as the widget so
tokens aren't securable. The host-native dialog turned out to be the
right consent surface anyway.

## Subpath Exports

The SDK provides several subpath exports for tree-shaking:

- `@umbraco-cms/mcp-server-sdk` - Main exports
- `@umbraco-cms/mcp-server-sdk/testing` - Testing utilities
- `@umbraco-cms/mcp-server-sdk/evals` - Eval testing framework
- `@umbraco-cms/mcp-server-sdk/config` - Configuration utilities
- `@umbraco-cms/mcp-server-sdk/helpers` - Helper functions
- `@umbraco-cms/mcp-server-sdk/types` - Type definitions
- `@umbraco-cms/mcp-server-sdk/constants` - Umbraco well-known IDs

## Requirements

- Node.js >= 22.0.0
- TypeScript >= 5.0
- `@anthropic-ai/claude-agent-sdk` (optional, for eval testing)

## License

MIT
