# Umbraco MCP Server SDK

This monorepo contains the Umbraco MCP (Model Context Protocol) Server SDK for building MCP servers that expose Umbraco APIs to AI assistants.

## Packages

### [@umbraco-cms/mcp-server-sdk](./packages/mcp-server-sdk)

The core SDK package providing:
- Tool result formatting and error handling (ProblemDetails aware)
- Structured content helpers with type safety
- Tool decorators (error handling, validation, composition)
- Configuration loading (modes, slices, collections)
- Testing infrastructure (snapshot normalization, test environment setup)
- Eval testing framework (LLM-based acceptance tests using Claude Agent SDK)

**Install from npm:**
```bash
npm install @umbraco-cms/mcp-server-sdk
```

### [@umbraco-cms/create-umbraco-mcp-server](./packages/create-mcp-server)

CLI tool for scaffolding, configuring, and discovering APIs for new MCP server projects. Covers the first three phases of the [development workflow](./packages/create-mcp-server/README.md):

1. **Create** — scaffold a new project
2. **Init** — configure Umbraco instance and features
3. **Discover** — analyze APIs and plan tool collections

```bash
npx @umbraco-cms/create-umbraco-mcp-server my-mcp-server
```

### [Claude Code Plugin](./plugins)

Skills and agents for building Umbraco MCP servers in Claude Code. Covers Phases 4-5 of the [development workflow](./packages/create-mcp-server/README.md) — tool implementation, testing, and LLM evaluation.

### [Template](./template)

The starter kit bundled by `@umbraco-cms/create-umbraco-mcp-server`. Pre-configured with the SDK, example tools, tests, and Orval integration.

## Getting Started

### Create a New MCP Server

```bash
npx @umbraco-cms/create-umbraco-mcp-server my-mcp-server
cd my-mcp-server
npm install
npx @umbraco-cms/create-umbraco-mcp-server init
```

See the full [development workflow documentation](./packages/create-mcp-server/README.md) for all five phases.

### Building the SDK

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Run tests
npm run test
```

## Who Is This For?

This SDK is designed for:

1. **Umbraco Add-on Developers** - Creating MCP extensions for:
   - Umbraco Commerce
   - Umbraco Forms
   - Umbraco Deploy
   - Custom packages

2. **External Developers** - Building MCP servers for:
   - Custom Umbraco APIs
   - Third-party integrations
   - Private Umbraco installations

## Architecture

```
Umbraco-MCP-Base/
├── packages/
│   ├── mcp-server-sdk/        # @umbraco-cms/mcp-server-sdk (npm package)
│   │   ├── src/
│   │   │   ├── helpers/       # Tool result, API call, decorators
│   │   │   ├── config/        # Collection/slice/mode configuration
│   │   │   ├── testing/       # Snapshot normalization, test setup
│   │   │   ├── evals/         # LLM-based acceptance testing
│   │   │   └── types/         # Tool and collection types
│   │   └── package.json
│   │
│   └── create-mcp-server/     # @umbraco-cms/create-umbraco-mcp-server CLI (npm package)
│       └── src/
│           ├── scaffold.ts    # Phase 1: project scaffolding
│           ├── init/          # Phase 2: instance setup, feature config
│           └── discover/      # Phase 3: API discovery, client generation
│
├── plugins/                   # Claude Code skills & agents (not published)
│   ├── skills/                # /build-tools, /build-evals, /mcp-patterns, etc.
│   └── agents/                # mcp-tool-creator, mcp-tool-reviewer, etc.
│
├── template/                  # Starter kit bundled by create-mcp-server
│   ├── src/
│   │   └── tools/
│   ├── __tests__/
│   └── package.json
│
└── package.json               # Monorepo root
```

## License

MIT
