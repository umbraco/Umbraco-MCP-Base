# Umbraco MCP Server CLI Reference

Umbraco MCP servers built with `@umbraco-cms/mcp-server-sdk` run as CLI tools over stdio. The CLI handles authentication and configuration, then exposes tools that talk directly to the Umbraco Management API. Your AI agent (Claude Code, Cursor, etc.) calls these tools to read and manage content in your Umbraco instance.

> **Note:** The CLI is designed to be consumed by AI agents, not operated directly by humans. You configure it with environment variables or flags, then your AI agent connects and interacts with Umbraco through the exposed tools. The introspection commands (`--list-tools`, `--debug-config`, etc.) are the human-facing part — use them to understand and verify what your agent will see.

> **Using Claude Code?** Install the `umbraco-mcp-server` plugin for interactive CLI guidance — run `/mcp-cli` for help with setup, filtering, and debugging.
> ```bash
> /plugin marketplace add umbraco/Umbraco-MCP-Base
> /plugin install umbraco-mcp-server@umbraco/Umbraco-MCP-Base
> ```

## Authentication

| Flag | Env Var | Required | Description |
|------|---------|----------|-------------|
| `--umbraco-client-id` | `UMBRACO_CLIENT_ID` | Yes | OAuth client ID from Umbraco API user |
| `--umbraco-client-secret` | `UMBRACO_CLIENT_SECRET` | Yes | OAuth client secret |
| `--umbraco-base-url` | `UMBRACO_BASE_URL` | Yes | Umbraco instance URL |
| `--env` | — | No | Path to custom `.env` file |

Auth credentials are created in the Umbraco backoffice under **Settings > Users** as an API user.

### Configuration Precedence

CLI arguments > environment variables > `.env` file values.

A `.env` file in the current working directory is loaded automatically. Use `--env /path/to/.env` to specify a custom location.

## Starting the Server

```bash
# Via npx (published package)
npx @umbraco-cms/mcp-dev \
  --umbraco-client-id="your-client-id" \
  --umbraco-client-secret="your-secret" \
  --umbraco-base-url="https://localhost:44391"

# Via built project
node dist/index.js \
  --umbraco-client-id="your-client-id" \
  --umbraco-client-secret="your-secret" \
  --umbraco-base-url="https://localhost:44391"

# Via environment variables
UMBRACO_CLIENT_ID="your-client-id" \
UMBRACO_CLIENT_SECRET="your-secret" \
UMBRACO_BASE_URL="https://localhost:44391" \
node dist/index.js
```

### Claude Code Configuration

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": [
        "@umbraco-cms/mcp-dev",
        "--umbraco-client-id=your-client-id",
        "--umbraco-client-secret=your-secret",
        "--umbraco-base-url=https://localhost:44391"
      ]
    }
  }
}
```

## Tool Filtering

Control which tools are exposed to the LLM. All accept comma-separated values via CLI flags or environment variables.

| Flag | Env Var | Description |
|------|---------|-------------|
| `--umbraco-tool-modes` | `UMBRACO_TOOL_MODES` | Enable named groups of collections |
| `--umbraco-include-tool-collections` | `UMBRACO_INCLUDE_TOOL_COLLECTIONS` | Only expose these collections |
| `--umbraco-exclude-tool-collections` | `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` | Hide these collections |
| `--umbraco-include-slices` | `UMBRACO_INCLUDE_SLICES` | Only expose tools with these slices |
| `--umbraco-exclude-slices` | `UMBRACO_EXCLUDE_SLICES` | Hide tools with these slices |
| `--umbraco-include-tools` | `UMBRACO_INCLUDE_TOOLS` | Only expose these specific tools |
| `--umbraco-exclude-tools` | `UMBRACO_EXCLUDE_TOOLS` | Hide these specific tools |

### Available Slices

`read`, `list`, `create`, `update`, `delete`, `search`, `tree`, `publish`, `move`, `copy`

### Filter Precedence

Filters combine in this order (most specific wins):

1. Tool exclusions — always excluded
2. Tool inclusions — if set, only these tools
3. Slice exclusions — tools with these slices excluded
4. Slice inclusions — if set, only tools with these slices
5. Collection exclusions — entire collections excluded
6. Collection inclusions — if set, only these collections

Exclude always takes precedence over include at the same level.

### Examples

```bash
# Read-only content browsing
UMBRACO_INCLUDE_SLICES=read,list,search \
UMBRACO_INCLUDE_TOOL_COLLECTIONS=content,media \
node dist/index.js

# Everything except delete operations
UMBRACO_EXCLUDE_SLICES=delete node dist/index.js

# Only specific tools
UMBRACO_INCLUDE_TOOLS=get-content-by-id,list-content node dist/index.js
```

## Runtime Modes

### Readonly Mode

```bash
node dist/index.js --umbraco-readonly
# or: UMBRACO_READONLY=true
```

Mutation tools are completely removed from the server — the agent cannot see or call them. Only tools with `readOnlyHint: true` are registered. Use this when you want zero risk of data modification.

### Dry-Run Mode

```bash
node dist/index.js --umbraco-dry-run
# or: UMBRACO_DRY_RUN=true
```

- Read-only tools execute normally and return real data
- Mutation tools return a structured preview without calling the Umbraco API:

```json
{
  "dryRun": true,
  "toolName": "delete-example",
  "wouldExecute": true,
  "inputReceived": { "id": "550e8400-e29b-41d4-a716-446655440000" },
  "annotations": { "readOnlyHint": false, "destructiveHint": true }
}
```

- Input validation still runs, so the LLM gets validation feedback
- Use this for safe exploration — the LLM can try mutation tools without risk

### Readonly vs Dry-Run

| | Readonly | Dry-Run |
|---|---------|---------|
| LLM sees mutation tools | No | Yes |
| Mutation tools execute | N/A | No (preview only) |
| Read tools execute | Yes | Yes |
| Risk level | Zero | Very low |

## Introspection Commands

These flags print output and exit immediately — they do not start the MCP server and do not require auth credentials or a running Umbraco instance.

Introspection respects all filtering configuration. If you set `UMBRACO_READONLY=true` or any filtering env var, the output only shows tools that pass those filters — exactly what the LLM would see at runtime.

| Flag | Description |
|------|-------------|
| `--list-tools` | Print ASCII table of all tools (name, collection, slices, annotations) |
| `--describe-tool <name>` | Print full JSON schema and metadata for a specific tool (exits 1 if not found or filtered out) |
| `--generate-context` | Output structured CONTEXT.md documenting all tools (pipe to file) |
| `--debug-config` | Print resolved configuration as JSON (values, sources, filter config) |

### `--list-tools` Output

```
Name             | Collection | Slices | RO | Destr | Description
-----------------+------------+--------+----+-------+---------------------------------------------
get-example      | example    | read   | Y  | N     | Gets an example item by ID.
list-examples    | example    | list   | Y  | N     | Lists all example items with pagination.
create-example   | example    | create | N  | N     | Creates a new example item.
delete-example   | example    | delete | N  | Y     | Deletes an example item by ID.
```

### `--describe-tool` Output

```json
{
  "name": "get-example",
  "collection": "example",
  "description": "Gets an example item by ID.",
  "slices": ["read"],
  "annotations": { "readOnlyHint": true },
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "The example item ID (UUID)" }
    },
    "required": ["id"]
  }
}
```

### Examples

```bash
# See all tools
node dist/index.js --list-tools

# See only what the LLM sees with filtering
UMBRACO_READONLY=true node dist/index.js --list-tools
UMBRACO_INCLUDE_SLICES=read,list node dist/index.js --list-tools

# Get schema for a specific tool
node dist/index.js --describe-tool get-content-by-id

# Generate documentation
node dist/index.js --generate-context > CONTEXT.md

# Debug configuration — see resolved values and their sources
node dist/index.js --debug-config
UMBRACO_READONLY=true UMBRACO_INCLUDE_SLICES=read node dist/index.js --debug-config
```

### Debug Config Output

`--debug-config` prints JSON showing every config field with its resolved value and source (`cli`, `env`, or `none`). Credentials are masked. The `resolvedFilterConfig` section shows the final filter state applied to tools.

```json
{
  "envFile": { "source": "default" },
  "auth": {
    "baseUrl": { "value": "https://localhost:44391", "source": "env" },
    "clientId": { "value": "***", "source": "env" },
    "clientSecret": { "value": "***", "source": "env" }
  },
  "filtering": {
    "readonly": { "value": true, "source": "env" },
    "includeSlices": { "value": ["read", "list"], "source": "env" },
    ...
  },
  "resolvedFilterConfig": {
    "readOnly": true,
    "enabledSlices": ["read", "list"],
    ...
  }
}
```

## Other Options

| Flag | Env Var | Description |
|------|---------|-------------|
| `--umbraco-allowed-media-paths` | `UMBRACO_ALLOWED_MEDIA_PATHS` | Restrict media operations to these paths |
| `--disable-output-compatibility-mode` | `DISABLE_OUTPUT_COMPATIBILITY_MODE` | Use structured output instead of text |

## Input Sanitization

The SDK automatically validates all string inputs before tool handlers run:
- Rejects control characters, path traversal (`../`), embedded query params, percent-encoded strings
- Validates UUID format where expected
- Returns ProblemDetails (RFC 7807) with clear error messages

The LLM receives validation errors and can self-correct. No configuration needed.
