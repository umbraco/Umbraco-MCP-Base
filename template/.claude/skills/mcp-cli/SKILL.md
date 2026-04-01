---
name: mcp-cli
description: Guide for running and debugging this Umbraco MCP server via the CLI. Use when the user wants to list tools, call tools, configure filtering, dry-run, readonly mode, or debug configuration.
---

# Umbraco MCP Server — CLI Guide

This MCP server runs as a CLI tool over stdio. The CLI handles authentication and configuration, then exposes tools that talk directly to the Umbraco Management API.

## Quick Reference

```bash
# List all tools
node dist/index.js --list-tools

# Describe a specific tool's schema
node dist/index.js --describe-tool <tool-name>

# Call a tool directly (requires auth via .env)
node dist/index.js --call <tool-name> --call-args '{"key":"value"}'

# Generate context documentation
node dist/index.js --generate-context > CONTEXT.md

# Debug resolved configuration
node dist/index.js --debug-config
```

## Authentication

**Never pass secrets as CLI arguments.** Use a `.env` file or the MCP config `env` block.

| Env Var | Required | Description |
|---------|----------|-------------|
| `UMBRACO_CLIENT_ID` | Yes | OAuth client ID from Umbraco API user |
| `UMBRACO_CLIENT_SECRET` | Yes | OAuth client secret |
| `UMBRACO_BASE_URL` | Yes | Umbraco instance URL |

Create a `.env` file:
```
UMBRACO_CLIENT_ID=your-client-id
UMBRACO_CLIENT_SECRET=your-secret
UMBRACO_BASE_URL=https://localhost:44391
```

Introspection commands (`--list-tools`, `--describe-tool`, `--generate-context`) do not require auth.

## Starting the Server

```bash
# With .env file (recommended)
node dist/index.js

# Custom .env path
node dist/index.js --env /path/to/.env
```

### Claude Code Configuration

Use the `env` block for credentials:
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

## Tool Filtering

| Flag | Env Var | Description |
|------|---------|-------------|
| `--umbraco-tool-modes` | `UMBRACO_TOOL_MODES` | Enable named groups of collections |
| `--umbraco-include-slices` | `UMBRACO_INCLUDE_SLICES` | Only expose tools with these slices |
| `--umbraco-exclude-slices` | `UMBRACO_EXCLUDE_SLICES` | Hide tools with these slices |
| `--umbraco-include-tool-collections` | `UMBRACO_INCLUDE_TOOL_COLLECTIONS` | Only expose these collections |
| `--umbraco-exclude-tool-collections` | `UMBRACO_EXCLUDE_TOOL_COLLECTIONS` | Hide these collections |
| `--umbraco-include-tools` | `UMBRACO_INCLUDE_TOOLS` | Only expose these specific tools |
| `--umbraco-exclude-tools` | `UMBRACO_EXCLUDE_TOOLS` | Hide these specific tools |

Available slices: `read`, `list`, `create`, `update`, `delete`, `search`, `tree`, `publish`, `move`, `copy`.

Exclude takes precedence over include. Filters combine.

## Runtime Modes

### Readonly mode
```bash
node dist/index.js --umbraco-readonly
```
Mutation tools are completely removed — the LLM won't see them at all.

### Dry-run mode
```bash
node dist/index.js --umbraco-dry-run
```
Read tools execute normally. Mutation tools return a preview without calling the API.

## Introspection Commands

These print output and exit immediately — they do not start the MCP server.

| Flag | Description |
|------|-------------|
| `--list-tools` | Print ASCII table of all tools |
| `--describe-tool <name>` | Print full JSON schema for a tool |
| `--generate-context` | Output CONTEXT.md documenting all tools |
| `--debug-config` | Print resolved config (secrets masked) |
| `--call <name>` | Call a tool directly, print JSON result |
| `--call-args <json>` | JSON arguments for `--call` (default: `{}`) |

Introspection respects all filtering. `--list-tools` with `UMBRACO_READONLY=true` shows exactly what the LLM would see.

## Input Sanitization

The SDK validates all string inputs before tool handlers run:
- Rejects control characters, path traversal (`../`), embedded query params, percent-encoded strings
- Validates UUID format where expected
- Returns clear error messages for agent self-correction
