# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the MCP server operations plugin.

## Plugin Overview

Claude Code plugin providing skills for configuring, running, and debugging Umbraco MCP servers. Not published to npm (distributed via Claude Code marketplace).

## Structure

```
plugins-server/umbraco-mcp-server/
└── skills/
    └── mcp-cli/
        ├── SKILL.md              # CLI configuration and usage guide
        └── local-dev-testing.md  # SDK contributor testing guidance
```

## Skills

| Skill | Command | Purpose |
|-------|---------|---------|
| mcp-cli | `/mcp-cli` | CLI configuration, auth setup, filtering, introspection, dry-run, readonly mode |

## Installation

Users install via Claude Code:
```bash
/plugin marketplace add umbraco/Umbraco-MCP-Base
/plugin install umbraco-mcp-server@umbraco/Umbraco-MCP-Base
```
