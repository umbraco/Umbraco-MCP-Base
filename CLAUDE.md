# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monorepo for the Umbraco MCP (Model Context Protocol) toolkit - infrastructure for building MCP servers that expose Umbraco APIs to AI assistants.

## Monorepo Structure

| Workspace | Description | Published |
|-----------|-------------|-----------|
| `packages/toolkit/` | Core npm package `@umbraco-cms/mcp-toolkit` | Yes |
| `template/` | Starter kit for new MCP server projects | No |
| `plugins/` | Claude Code plugins for Umbraco development | No |

Each workspace has its own CLAUDE.md with detailed guidance.

## Build Commands

```bash
npm install           # Install all workspace dependencies
npm run build         # Build toolkit
npm run test          # Test toolkit
```

Workspace-specific commands use `-w` flag: `npm run build -w packages/toolkit`

## Toolkit Package Exports

| Entry Point | Purpose |
|-------------|---------|
| `@umbraco-cms/mcp-toolkit` | Main: tool helpers, decorators, types, config loaders |
| `@umbraco-cms/mcp-toolkit/testing` | Test utilities: setupTestEnvironment, setupMswServer, snapshot helpers |
| `@umbraco-cms/mcp-toolkit/evals` | LLM eval framework: runScenarioTest, verification helpers |
| `@umbraco-cms/mcp-toolkit/config` | Configuration loading |
| `@umbraco-cms/mcp-toolkit/helpers` | API call helpers only |

## Core Concepts

**ToolDefinition** - Type-safe tool structure with name, description, input/output schemas, slices, annotations, and handler.

**Tool Collections** - Groups of related tools with metadata (name, displayName, description, dependencies).

**Tool Filtering** - Filter tools by modes (collection groups), slices (operation categories), collections, or individual tool names. Configured via env vars or CLI flags.

**API Call Helpers** - Standardized handlers for GET, DELETE, PUT, POST operations with automatic error handling and ProblemDetails support.

**MCP Chaining** - Proxy tools from other MCP servers via McpClientManager.

## Requirements

- Node.js 22+
- ESM modules (type: "module")
