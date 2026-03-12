# Tool Filtering & Configuration

The SDK provides a layered filtering system that controls which tools are registered with the MCP server. Filters are configured via environment variables or CLI flags and evaluated at startup.

## Concepts

| Concept | What it is | Example |
|---------|-----------|---------|
| **Mode** | Named preset that maps to a set of collections | `"content"` → `["document", "document-type", "template"]` |
| **Collection** | Group of related tools with metadata | `"document"` containing get/list/create/update/delete tools |
| **Slice** | Operation category assigned to individual tools | `"read"`, `"create"`, `"update"`, `"delete"`, `"list"` |
| **Tool** | Individual tool filtered by name | `"get-document"`, `"create-document"` |

### How Filters Compose

Filters are applied in layers. A tool must pass **all** active filters to be registered:

1. **Collection filter** — Is this tool's collection enabled? (via modes, include/exclude lists)
2. **Slice filter** — Is this tool's slice enabled? (via include/exclude slice lists)
3. **Tool filter** — Is this specific tool enabled? (via include/exclude tool lists)
4. **Read-only filter** — If `readOnly: true`, only tools with `readOnlyHint` annotation pass

Empty filter = no restriction. For example, if `enabledSlices` is empty, all slices pass.

### Modes × Slices Matrix

Modes and slices are independent axes. Setting `mode=content` includes content-related collections. Setting `slices=read,list` includes only read/list operations. Combined, you get only read/list tools from content collections.

## CollectionConfiguration

The output of the config loading process — passed to `shouldIncludeTool`:

```typescript
interface CollectionConfiguration {
  enabledCollections: string[];   // If non-empty, only these collections load
  disabledCollections: string[];  // Always excluded
  enabledSlices: string[];        // If non-empty, only tools in these slices load
  disabledSlices: string[];       // Tools in these slices never load
  enabledTools: string[];         // If non-empty, only these tools load
  disabledTools: string[];        // Always excluded
  readOnly: boolean;              // Only readOnlyHint tools when true
}
```

## Configuration Flow

### 1. Define Registries (in your project)

```typescript
// src/config/modes.ts
import { ToolModeDefinition } from "@umbraco-cms/mcp-server-sdk";

export const allModes: ToolModeDefinition[] = [
  {
    name: "content",
    displayName: "Content Management",
    description: "Tools for managing content",
    collections: ["document", "document-type", "template"],
  },
  {
    name: "media",
    displayName: "Media Management",
    description: "Tools for managing media",
    collections: ["media", "media-type"],
  },
];

export const allModeNames = allModes.map(m => m.name);
export const allSliceNames = ["read", "create", "update", "delete", "list", "search"];
```

### 2. Create the Config Loader

```typescript
import { createCollectionConfigLoader } from "@umbraco-cms/mcp-server-sdk";

const configLoader = createCollectionConfigLoader({
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,  // Optional, defaults to baseSliceNames
});
```

### 3. Load Configuration

```typescript
const filterConfig = configLoader.loadFromConfig({
  toolModes: ["content"],                    // Expand to collections
  includeToolCollections: ["custom-tools"],   // Merge with mode-expanded collections
  excludeToolCollections: ["deprecated"],     // Always remove these
  includeSlices: ["read", "list"],           // Only these operations
  excludeSlices: [],
  includeTools: [],
  excludeTools: ["dangerous-tool"],          // Block specific tools
  readOnly: false,
});
```

### 4. Filter Tools at Registration

```typescript
import { shouldIncludeTool } from "@umbraco-cms/mcp-server-sdk";

for (const tool of collection.tools({})) {
  if (!shouldIncludeTool(tool, { collectionName: collection.metadata.name, config: filterConfig })) {
    continue;
  }
  server.registerTool(tool.name, { /* ... */ }, tool.handler);
}
```

## Filtering Functions

### `shouldIncludeTool(tool, context)`

Returns `true` if a tool passes all filters. Used when registering tools one at a time.

```typescript
import { shouldIncludeTool, ToolFilterContext } from "@umbraco-cms/mcp-server-sdk";

const context: ToolFilterContext = {
  collectionName: "document",
  config: filterConfig,
};

if (shouldIncludeTool(tool, context)) {
  // Register tool
}
```

### `filterTools(tools, collectionName, config)`

Filters an array of tools. Returns only those that pass all filters.

```typescript
import { filterTools } from "@umbraco-cms/mcp-server-sdk";

const filtered = filterTools(allTools, "document", filterConfig);
```

### Validation Helpers

```typescript
import { validateSliceNames, validateModeNames } from "@umbraco-cms/mcp-server-sdk";

// Validate slice names against known slices
const { valid, invalid } = validateSliceNames(["read", "typo"], allSliceNames);
// valid: ["read"], invalid: ["typo"]

// Validate mode names against known modes
const { validModes, invalidModes } = validateModeNames(["content", "typo"], allModeNames);
// validModes: ["content"], invalidModes: ["typo"]
```

### `expandModesToCollections(modeNames, modeRegistry)`

Resolves mode names to collection names:

```typescript
import { expandModesToCollections } from "@umbraco-cms/mcp-server-sdk";

const collections = expandModesToCollections(["content"], allModes);
// ["document", "document-type", "template"]
```

## Environment Variables & CLI Flags

| Env Var | CLI Flag | Type | Description |
|---------|----------|------|-------------|
| `UMBRACO_TOOL_MODES` | `--umbraco-tool-modes` | CSV | Modes to enable |
| `UMBRACO_INCLUDE_TOOL_COLLECTIONS` | `--umbraco-include-tool-collections` | CSV | Collections to include |
| `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` | `--umbraco-exclude-tool-collections` | CSV | Collections to exclude |
| `UMBRACO_INCLUDE_SLICES` | `--umbraco-include-slices` | CSV | Slices to include |
| `UMBRACO_EXCLUDE_SLICES` | `--umbraco-exclude-slices` | CSV | Slices to exclude |
| `UMBRACO_INCLUDE_TOOLS` | `--umbraco-include-tools` | CSV | Individual tools to include |
| `UMBRACO_EXCLUDE_TOOLS` | `--umbraco-exclude-tools` | CSV | Individual tools to exclude |
| `UMBRACO_READONLY` | `--umbraco-readonly` | Boolean | Only register read-only tools |

CLI flags take precedence over env vars. CSV values are comma-separated.

## Base Slice Names

The SDK defines a minimal set of slice names:

```typescript
const baseSliceNames = ["create", "read", "update", "delete", "list"] as const;
const allBaseSliceNames = [...baseSliceNames, "other"];  // Includes catch-all
```

Projects can extend with custom slices (e.g., `"search"`, `"publish"`) by passing `allSliceNames` to `createCollectionConfigLoader`.

## Reference

| Source File | Contains |
|-------------|----------|
| `src/tool-filtering/collection-config-loader.ts` | `createCollectionConfigLoader`, `ServerConfigForCollections` |
| `src/tool-filtering/tool-filter.ts` | `shouldIncludeTool`, `filterTools`, `ToolFilterContext` |
| `src/tool-filtering/mode-expander.ts` | `validateModeNames`, `expandModesToCollections` |
| `src/tool-filtering/slice-matcher.ts` | `validateSliceNames` |
| `src/types/collection-configuration.ts` | `CollectionConfiguration`, `DEFAULT_COLLECTION_CONFIG` |
| `src/types/tool-mode.ts` | `ToolModeDefinition` |
| `src/config/config.ts` | `getServerConfig` (loads env vars and CLI flags) |
