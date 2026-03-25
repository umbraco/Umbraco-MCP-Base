---
name: discover-mcp-server
description: Discover available tools in any Umbraco MCP server built with the SDK. Use when an agent needs to understand what tools exist, get detailed schema for a specific tool, or generate context documentation.
user_invocable: true
allowed-tools: Bash(npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts*), Bash(COMMAND=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts*), Bash(COMMAND=* TOOL_NAME=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts*), Bash(PROJECT_ROOT=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts*), Bash(PROJECT_ROOT=* COMMAND=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts*), Bash(PROJECT_ROOT=* COMMAND=* TOOL_NAME=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts*)
---

# Discover MCP Server

Discover and inspect tools in any Umbraco MCP server built with `@umbraco-cms/mcp-server-sdk`. This skill works with any SDK-based project (CMS, Forms, or custom implementations) because all servers share the same CLI interface via `handleCliCommands()`.

## When to Use

Use this skill when:
- An agent needs to know what tools are available in the MCP server
- You need the full JSON Schema and metadata for a specific tool
- You want to generate a CONTEXT.md file for LLM consumption
- You're debugging which tools are registered and how they're categorized
- Starting work on a project and need to understand the tool landscape

## Prerequisites

The consumer project must be **built** before running discovery:
```bash
npm run build
```

The script detects the server entry point from `package.json` (`main` or `bin` field).

## Commands

### List all tools

Shows a table of every registered tool with collection, slices, and annotations:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts
```

Output format:
```
Name              | Collection | Slices | RO | Destr | Description
------------------+------------+--------+----+-------+------------------------------------------
get-content-by-id | content    | read   | Y  | N     | Get a content item by its unique ID
delete-content    | content    | delete | N  | Y     | Permanently delete a content item
```

### Describe a specific tool

Get full JSON Schema, annotations, slices, and description for one tool:

```bash
COMMAND=describe-tool TOOL_NAME=get-content-by-id npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts
```

Output format (JSON):
```json
{
  "name": "get-content-by-id",
  "collection": "content",
  "description": "Get a content item by its unique ID",
  "slices": ["read"],
  "annotations": { "readOnlyHint": true },
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "The content item UUID" }
    },
    "required": ["id"]
  }
}
```

### Generate context file

Generate a full CONTEXT.md with all tools documented for LLM reference:

```bash
COMMAND=generate-context npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discover-mcp-server/scripts/discover-tools.ts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Path to the consumer project root | `.` (current directory) |
| `COMMAND` | One of: `list-tools`, `describe-tool`, `generate-context` | `list-tools` |
| `TOOL_NAME` | Tool name for `describe-tool` command | _(required for describe-tool)_ |
| `SERVER_ENTRY` | Override server entry point path | _(auto-detected from package.json)_ |

## How It Works

All Umbraco MCP servers built with the SDK use `handleCliCommands()` which adds three CLI flags:

| Flag | Purpose |
|------|---------|
| `--list-tools` | Print a formatted table of all registered tools |
| `--describe-tool <name>` | Print full JSON metadata for a specific tool |
| `--generate-context` | Generate structured CONTEXT.md to stdout |

These flags run **before** the MCP server starts and exit immediately — they don't require a running Umbraco instance or valid auth credentials.

## Agent Workflow

When working with an MCP server project, use discovery in this order:

1. **Build first**: `npm run build` (tools must be compiled)
2. **List tools**: Get the full inventory — understand what's available
3. **Describe specific tools**: Deep-dive into tools relevant to your task
4. **Generate context** (optional): Create reference documentation

This gives the agent a complete understanding of the server's capabilities without reading source code.

## Cross-Project Usage

This skill works unchanged across all SDK-based projects:
- **Umbraco CMS MCP** — content, media, document types, etc.
- **Umbraco Forms MCP** — forms, fields, workflows, etc.
- **Custom MCP servers** — any project using `@umbraco-cms/mcp-server-sdk`

The script auto-detects the entry point from each project's `package.json`.
