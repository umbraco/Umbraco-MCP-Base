# CLI Features Guide

The Umbraco MCP Server provides CLI flags for introspection, configuration, and safety features. These work with both environment variables and command-line arguments.

## Quick Reference

```bash
# Introspection — inspect tools without starting the server
node dist/index.js --list-tools
node dist/index.js --describe-tool get-document
node dist/index.js --generate-context > CONTEXT.md

# Start with filtering
node dist/index.js \
  --umbraco-tool-modes content,media \
  --umbraco-exclude-slices delete \
  --umbraco-readonly

# Dry-run mode — preview mutations without executing
UMBRACO_DRY_RUN=true node dist/index.js
```

## Introspection Commands

These commands run before the MCP server starts and exit immediately after printing output. Useful for debugging, documentation generation, and CI pipelines.

### `--list-tools`

Prints a formatted table of all registered tools.

```
Name             | Collection | Slices | RO | Destr | Description
-----------------+------------+--------+----+-------+---------------------------------------------
get-example      | example    | read   | Y  | N     | Gets an example item by ID.
list-examples    | example    | list   | Y  | N     | Lists all example items with pagination.
create-example   | example    | create | N  | N     | Creates a new example item.
delete-example   | example    | delete | N  | Y     | Deletes an example item by ID.
```

Columns:
- **Name** — Tool identifier used in MCP `tools/call`
- **Collection** — Logical grouping the tool belongs to
- **Slices** — Operation categories (read, create, update, delete, list, etc.)
- **RO** — Read-only hint (Y = safe to call without side effects)
- **Destr** — Destructive hint (Y = may permanently delete data)
- **Description** — Truncated to 60 characters

### `--describe-tool <name>`

Prints full JSON metadata and input schema for a specific tool.

```bash
node dist/index.js --describe-tool get-example
```

```json
{
  "name": "get-example",
  "collection": "example",
  "description": "Gets an example item by ID.",
  "slices": ["read"],
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "The example item ID (UUID)"
      }
    },
    "required": ["id"]
  }
}
```

Exits with code 1 if the tool is not found.

### `--generate-context`

Generates a Markdown context file describing all tools, collections, and their parameters. Pipe to a file for use with AI assistants.

```bash
node dist/index.js --generate-context > CONTEXT.md
```

The output includes:
- Server name and version
- All collections with descriptions
- Every tool with parameters, types, and hints
- Placeholder sections for Workflows and Invariants

## Configuration

All configuration supports both CLI flags and environment variables. CLI flags take precedence over env vars, which take precedence over `.env` file values.

### Authentication (Required)

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--umbraco-client-id` | `UMBRACO_CLIENT_ID` | OAuth client ID |
| `--umbraco-client-secret` | `UMBRACO_CLIENT_SECRET` | OAuth client secret |
| `--umbraco-base-url` | `UMBRACO_BASE_URL` | Umbraco instance URL |

### Environment

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--env` | — | Path to custom `.env` file (defaults to `.env` in cwd) |

## Tool Filtering

Control which tools are registered with the MCP server. Useful for limiting tool exposure per deployment or user role.

### By Mode

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--umbraco-tool-modes` | `UMBRACO_TOOL_MODES` | Comma-separated mode names |

Modes are named groups that expand to one or more collections. Define modes in your `mode-registry.ts`.

```bash
# Only expose content and media tools
node dist/index.js --umbraco-tool-modes content,media
```

### By Collection

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--umbraco-include-tool-collections` | `UMBRACO_INCLUDE_TOOL_COLLECTIONS` | Only these collections |
| `--umbraco-exclude-tool-collections` | `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` | Never these collections |

### By Slice

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--umbraco-include-slices` | `UMBRACO_INCLUDE_SLICES` | Only tools with these slices |
| `--umbraco-exclude-slices` | `UMBRACO_EXCLUDE_SLICES` | Never tools with these slices |

Available slices: `create`, `read`, `update`, `delete`, `list`, `tree`, `search`, `publish`, `move`, `copy`, and more as defined in `slice-registry.ts`.

```bash
# Read-only deployment — exclude all mutation slices
node dist/index.js --umbraco-exclude-slices create,update,delete
```

### By Tool Name

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--umbraco-include-tools` | `UMBRACO_INCLUDE_TOOLS` | Only these specific tools |
| `--umbraco-exclude-tools` | `UMBRACO_EXCLUDE_TOOLS` | Never these specific tools |

### Filter Priority

Filters are evaluated in order (first exclusion wins):

1. Tool exclusions (`--umbraco-exclude-tools`)
2. Tool inclusions (`--umbraco-include-tools`)
3. Slice exclusions (`--umbraco-exclude-slices`)
4. Slice inclusions (`--umbraco-include-slices`)
5. Collection exclusions (`--umbraco-exclude-tool-collections`)
6. Collection inclusions (from `--umbraco-include-tool-collections` + mode expansion)

## Safety Features

### Read-Only Mode

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--umbraco-readonly` | `UMBRACO_READONLY` | Block all write operations |

When enabled, mutation tools are blocked at the pre-execution check layer. Read-only tools (those with `readOnlyHint: true`) execute normally.

### Dry-Run Mode

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--umbraco-dry-run` | `UMBRACO_DRY_RUN` | Preview mutations without executing |

Intercepted mutation tools return a structured preview:

```json
{
  "dryRun": true,
  "toolName": "delete-example",
  "wouldExecute": true,
  "inputReceived": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "annotations": {
    "readOnlyHint": false,
    "destructiveHint": true,
    "idempotentHint": false
  }
}
```

Read-only tools execute normally even in dry-run mode.

### Input Sanitization

Applied automatically via `withStandardDecorators()` on all tools. No configuration needed.

Protections:
- **Control characters** — Rejects ASCII 0x00-0x1F (except tab, newline, carriage return)
- **Path traversal** — Rejects `../`, `..\`, and absolute paths
- **Query parameter injection** — Rejects `?` and `&` in string fields
- **Pre-encoded strings** — Rejects percent-encoded sequences like `%2F`
- **UUID validation** — Validates UUID format where applicable

Fields marked with `[raw]` in their Zod description skip sanitization (for user content like HTML or markdown).

## Output Configuration

| CLI Flag | Env Var | Description |
|----------|---------|-------------|
| `--disable-output-compatibility-mode` | `DISABLE_OUTPUT_COMPATIBILITY_MODE` | Return `structuredContent` only |

**Default (compatibility mode on):** Tool results include both `content` (JSON as text) and `structuredContent` for broad MCP client support.

**Compatibility mode off:** Tool results include only `structuredContent`. Use this with clients that support structured output (Claude Code, Claude Desktop).

## Configuration Precedence

1. **CLI arguments** (highest priority)
2. **Environment variables**
3. **`.env` file** (lowest priority, or custom path via `--env`)

In non-stdio mode, the resolved configuration and sources are logged to the console at startup. Secrets are masked.
