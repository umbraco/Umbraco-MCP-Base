# Server Configuration

How to configure the MCP server using environment variables and CLI flags.

## `getServerConfig(isStdioMode, options?)`

Loads configuration from environment variables and CLI flags. CLI flags take precedence.

```typescript
import { getServerConfig } from "@umbraco-cms/mcp-server-sdk/config";

const { config, custom } = getServerConfig(true);  // true = stdio transport mode
```

### Return Value

```typescript
interface GetServerConfigResult {
  config: UmbracoServerConfig;                              // Standard config
  custom: Record<string, string | string[] | boolean>;      // Custom fields (if any)
}
```

### Standard Configuration

```typescript
interface UmbracoServerConfig {
  auth: {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
  };
  toolModes?: string[];
  includeToolCollections?: string[];
  excludeToolCollections?: string[];
  includeSlices?: string[];
  excludeSlices?: string[];
  includeTools?: string[];
  excludeTools?: string[];
  allowedMediaPaths?: string[];
  readonly?: boolean;
  configSources: Record<string, "cli" | "env" | "none" | "default">;
}
```

## Configuration Sources

### Environment Variables

Set in `.env` or shell environment:

```env
UMBRACO_BASE_URL=https://my-umbraco.com
UMBRACO_CLIENT_ID=my-client
UMBRACO_CLIENT_SECRET=my-secret
UMBRACO_TOOL_MODES=content,media
UMBRACO_INCLUDE_SLICES=read,list
UMBRACO_READONLY=true
```

### CLI Flags

Pass as command-line arguments:

```bash
node dist/index.js \
  --umbraco-base-url https://my-umbraco.com \
  --umbraco-client-id my-client \
  --umbraco-client-secret my-secret \
  --umbraco-tool-modes content,media \
  --umbraco-readonly
```

### `.env` File

By default, `getServerConfig` loads from `.env` in the working directory. Override with `--env-file`:

```bash
node dist/index.js --env-file .env.production
```

## All Config Fields

| Field | Env Var | CLI Flag | Type | Required |
|-------|---------|----------|------|----------|
| `clientId` | `UMBRACO_CLIENT_ID` | `--umbraco-client-id` | string | Yes |
| `clientSecret` | `UMBRACO_CLIENT_SECRET` | `--umbraco-client-secret` | string | Yes |
| `baseUrl` | `UMBRACO_BASE_URL` | `--umbraco-base-url` | string | Yes |
| `toolModes` | `UMBRACO_TOOL_MODES` | `--umbraco-tool-modes` | CSV | No |
| `includeToolCollections` | `UMBRACO_INCLUDE_TOOL_COLLECTIONS` | `--umbraco-include-tool-collections` | CSV | No |
| `excludeToolCollections` | `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` | `--umbraco-exclude-tool-collections` | CSV | No |
| `includeSlices` | `UMBRACO_INCLUDE_SLICES` | `--umbraco-include-slices` | CSV | No |
| `excludeSlices` | `UMBRACO_EXCLUDE_SLICES` | `--umbraco-exclude-slices` | CSV | No |
| `includeTools` | `UMBRACO_INCLUDE_TOOLS` | `--umbraco-include-tools` | CSV | No |
| `excludeTools` | `UMBRACO_EXCLUDE_TOOLS` | `--umbraco-exclude-tools` | CSV | No |
| `allowedMediaPaths` | `UMBRACO_ALLOWED_MEDIA_PATHS` | `--umbraco-allowed-media-paths` | CSV-path | No |
| `readonly` | `UMBRACO_READONLY` | `--umbraco-readonly` | boolean | No |

**CSV** = comma-separated values. **CSV-path** = comma-separated file paths.

## Custom Config Fields

Extend the config with additional fields specific to your project:

```typescript
const { config, custom } = getServerConfig(true, {
  additionalFields: [
    {
      name: "disableMcpChaining",
      envVar: "DISABLE_MCP_CHAINING",
      cliFlag: "disable-mcp-chaining",
      type: "boolean",
    },
    {
      name: "externalApiKey",
      envVar: "EXTERNAL_API_KEY",
      cliFlag: "external-api-key",
      type: "string",
      isSecret: true,
    },
  ],
});

// Access custom fields
const chainingDisabled = custom.disableMcpChaining;  // boolean
const apiKey = custom.externalApiKey;                 // string
```

### Field Type Reference

| Type | Parse Behavior | Example |
|------|---------------|---------|
| `string` | Used as-is | `"https://example.com"` |
| `boolean` | `"true"` → `true`, flag presence → `true` | `true` |
| `csv` | Split on comma, trim whitespace | `"a, b, c"` → `["a", "b", "c"]` |
| `csv-path` | Split on comma, resolve paths | `"./media, /uploads"` → resolved paths |

## Connecting Config to Filtering

The standard flow connects `getServerConfig` output to the collection config loader:

```typescript
import { getServerConfig } from "@umbraco-cms/mcp-server-sdk/config";
import { createCollectionConfigLoader } from "@umbraco-cms/mcp-server-sdk";

const { config } = getServerConfig(true);

const configLoader = createCollectionConfigLoader({
  modeRegistry: allModes,
  allModeNames,
});

const filterConfig = configLoader.loadFromConfig({
  toolModes: config.toolModes,
  includeToolCollections: config.includeToolCollections,
  excludeToolCollections: config.excludeToolCollections,
  includeSlices: config.includeSlices,
  excludeSlices: config.excludeSlices,
  includeTools: config.includeTools,
  excludeTools: config.excludeTools,
  readOnly: config.readonly,
});
```

See [Tool Filtering](./tool-filtering.md) for how to use the filter config.

## Reference

| Source File | Contains |
|-------------|----------|
| `src/config/config.ts` | `getServerConfig`, `UmbracoServerConfig`, `ConfigFieldDefinition` |
