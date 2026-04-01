---
name: mcp-cli
description: Guide for configuring and running Umbraco MCP servers via the CLI. Use when the user wants to set up an MCP server for Claude Code, configure auth, filtering, dry-run, readonly mode, or use introspection commands to understand available tools.
---

# Umbraco MCP Server — CLI Guide

Umbraco MCP servers built with `@umbraco-cms/mcp-server-sdk` run as CLI tools. You start the server with auth credentials and configuration flags, and it runs as an MCP server over stdio. Claude Code (or any MCP client) then connects and the LLM can call tools in an authenticated state.

## How It Works

1. You run the CLI with auth credentials and optional configuration flags
2. The server authenticates against your Umbraco instance using OAuth client credentials
3. It starts an MCP server listening on stdin/stdout
4. Claude Code connects via MCP protocol and the LLM can call tools

The LLM never handles authentication — the CLI does that. The LLM just sees the tools and calls them.

## Starting the Server

**IMPORTANT: Never pass secrets as CLI arguments.** CLI arguments are visible in terminal output, process listings, shell history, and conversation context. Always use a `.env` file or the MCP config `env` block for `UMBRACO_CLIENT_SECRET`.

### Via .env file (recommended)

Create a `.env` file in the project root:
```
UMBRACO_CLIENT_ID=your-client-id
UMBRACO_CLIENT_SECRET=your-secret
UMBRACO_BASE_URL=https://localhost:44391
```

Then start the server:
```bash
node dist/index.js
```

Or specify a custom `.env` path:
```bash
node dist/index.js --env /path/to/.env
```

### Via MCP config env block

When configuring in Claude Code's MCP settings, use the `env` block — these are passed as environment variables to the process, not as CLI arguments:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "UMBRACO_CLIENT_ID": "your-client-id",
        "UMBRACO_CLIENT_SECRET": "your-secret",
        "UMBRACO_BASE_URL": "https://localhost:44391"
      }
    }
  }
}
```

Non-secret flags like filtering and modes can safely be passed as CLI arguments or in the `env` block.

CLI arguments take precedence over environment variables, which take precedence over `.env` file values.

## Configuring Claude Code

Add the server to Claude Code's MCP configuration. Always use the `env` block for credentials — never pass secrets in `args`:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "npx",
      "args": ["@umbraco-cms/mcp-dev"],
      "env": {
        "UMBRACO_CLIENT_ID": "your-client-id",
        "UMBRACO_CLIENT_SECRET": "your-secret",
        "UMBRACO_BASE_URL": "https://localhost:44391"
      }
    }
  }
}
```

For a locally built server:

```json
{
  "mcpServers": {
    "umbraco": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "UMBRACO_CLIENT_ID": "your-client-id",
        "UMBRACO_CLIENT_SECRET": "your-secret",
        "UMBRACO_BASE_URL": "https://localhost:44391"
      }
    }
  }
}
```

## Runtime Modes

### Dry-run mode

```bash
node dist/index.js --umbraco-dry-run
# or: UMBRACO_DRY_RUN=true
```

- Read-only tools (queries) execute normally and return real data
- Mutation tools (create, update, delete) return a preview of what would happen without calling the Umbraco API
- Input validation still runs, so the LLM gets validation feedback
- Use this for safe exploration — the LLM can try mutation tools without risk

### Readonly mode

```bash
node dist/index.js --umbraco-readonly
# or: UMBRACO_READONLY=true
```

- Mutation tools are completely removed from the server — the LLM won't see them at all
- Only tools annotated with `readOnlyHint: true` are registered
- Use this when you want zero risk of data modification (e.g. auditing, reporting)

## Tool Filtering

Control which tools are exposed to the LLM. All accept comma-separated values.

| Flag | Env Var | Effect |
|------|---------|--------|
| `--umbraco-tool-modes` | `UMBRACO_TOOL_MODES` | Enable named groups of collections |
| `--umbraco-include-slices` | `UMBRACO_INCLUDE_SLICES` | Only expose tools with these slices |
| `--umbraco-exclude-slices` | `UMBRACO_EXCLUDE_SLICES` | Hide tools with these slices |
| `--umbraco-include-tool-collections` | `UMBRACO_INCLUDE_TOOL_COLLECTIONS` | Only expose these collections |
| `--umbraco-exclude-tool-collections` | `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` | Hide these collections |
| `--umbraco-include-tools` | `UMBRACO_INCLUDE_TOOLS` | Only expose these specific tools |
| `--umbraco-exclude-tools` | `UMBRACO_EXCLUDE_TOOLS` | Hide these specific tools |

Available slices: `read`, `list`, `create`, `update`, `delete`, `search`, `tree`, `publish`, `move`, `copy`.

Filters combine: slice filters apply within collection filters. Exclude takes precedence over include.

**Example — read-only content browsing:**
```bash
UMBRACO_INCLUDE_SLICES=read,list,search \
UMBRACO_INCLUDE_TOOL_COLLECTIONS=content,media \
node dist/index.js
```

## Introspection Commands

These flags print output and exit immediately — they do not start the MCP server.

Introspection respects all filtering configuration. If you set `UMBRACO_READONLY=true`, `UMBRACO_INCLUDE_SLICES`, `UMBRACO_INCLUDE_TOOL_COLLECTIONS`, or any other filtering env var / CLI flag, the introspection output only shows tools that pass those filters. This means `--list-tools` shows exactly what the LLM would see at runtime.

If auth credentials and a running Umbraco instance are available, introspection authenticates and fetches the current user so that tool listing also respects authorization policies. Without auth, collections that require a user are skipped and only unrestricted tools are listed.

| Flag | Purpose |
|------|---------|
| `--list-tools` | Print ASCII table of all tools (name, collection, slices, annotations) |
| `--describe-tool <name>` | Print full JSON schema and metadata for a specific tool |
| `--generate-context` | Output structured CONTEXT.md documenting all tools (pipe to file) |

```bash
# See all tools
node dist/index.js --list-tools

# Get schema for a specific tool
node dist/index.js --describe-tool get-content-by-id

# Generate documentation
node dist/index.js --generate-context > CONTEXT.md

# See only what the LLM sees with filtering active
UMBRACO_READONLY=true node dist/index.js --list-tools
UMBRACO_INCLUDE_SLICES=read,list node dist/index.js --list-tools
```

## Local Development Testing

See [local-dev-testing.md](local-dev-testing.md) for SDK contributor guidance on testing CLI commands locally, linking SDK builds, and integrating `handleCliCommands`.

## Input Sanitization

The SDK automatically validates all string inputs before tool handlers run:
- Rejects control characters, path traversal (`../`), embedded query params, percent-encoded strings
- Validates UUID format where expected
- Returns ProblemDetails (RFC 7807) with clear error messages

The LLM receives these validation errors and can self-correct and retry. No configuration needed.

## Auth Setup

The CLI requires OAuth client credentials to authenticate against Umbraco. These are created in the Umbraco backoffice under Settings > Users as an "API user":

| Env Var | Purpose |
|---------|---------|
| `UMBRACO_CLIENT_ID` | OAuth client ID from API user |
| `UMBRACO_CLIENT_SECRET` | OAuth client secret |
| `UMBRACO_BASE_URL` | Umbraco instance URL |

Store these in a `.env` file or in the MCP config `env` block. **Do not pass `UMBRACO_CLIENT_SECRET` as a CLI argument** — it will be visible in terminal output and conversation context.

Introspection commands (`--list-tools`, `--describe-tool`, `--generate-context`) do not require auth credentials.
