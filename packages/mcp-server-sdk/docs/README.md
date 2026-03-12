# @umbraco-cms/mcp-server-sdk

Infrastructure for building MCP servers that expose Umbraco APIs to AI assistants. Provides tool authoring primitives, API helpers, a flexible filtering system, MCP server chaining, and test utilities.

## Package Exports

| Entry Point | Purpose |
|-------------|---------|
| `@umbraco-cms/mcp-server-sdk` | Main: tool helpers, decorators, types, filtering, MCP chaining, constants |
| `@umbraco-cms/mcp-server-sdk/testing` | Test utilities: environment setup, MSW helpers, snapshot normalization |
| `@umbraco-cms/mcp-server-sdk/evals` | LLM eval framework: scenario tests, agent runner, verification |
| `@umbraco-cms/mcp-server-sdk/config` | Configuration loading from env vars and CLI flags |
| `@umbraco-cms/mcp-server-sdk/helpers` | API call helpers only |
| `@umbraco-cms/mcp-server-sdk/types` | Type definitions only |
| `@umbraco-cms/mcp-server-sdk/constants` | Umbraco well-known IDs (media types, user groups, etc.) |

## Documentation

| Guide | Description |
|-------|-------------|
| [Tool Authoring](./tool-authoring.md) | How the system works, adding collections and tools, examples |
| [API Helpers](./api-helpers.md) | API call helpers, HTTP client, ProblemDetails handling |
| [Tool Filtering](./tool-filtering.md) | Modes, slices, collections, configuration flow |
| [MCP Chaining](./mcp-chaining.md) | Proxying, delegation, and composite tool patterns |
| [Configuration](./configuration.md) | Server config, env vars, CLI flags, custom fields |
| [Constants](./constants.md) | Well-known Umbraco IDs reference |
| [Testing & Evals](./testing.md) | Unit testing, snapshot helpers, LLM eval framework |

## Getting Started

To create a new MCP server project using this SDK, see the [create-umbraco-mcp-server](../../CREATE-MCP-SERVER.md) workflow guide.

For Claude Code plugin development, see the skills and agents tables in [CREATE-MCP-SERVER.md](../../CREATE-MCP-SERVER.md).
