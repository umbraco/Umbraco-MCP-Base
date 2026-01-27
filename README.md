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

### [Template](./template)

A starter kit for creating new Umbraco MCP server extensions. Copy this folder to start a new project.

**Features:**
- Pre-configured with `@umbraco-cms/mcp-server-sdk`
- Simple example tool collection
- Example test with builder pattern
- Orval integration ready for any Umbraco OpenAPI spec
- TypeScript setup with path aliases

## Getting Started

### Using the Template

1. Copy the `/template` folder to a new location
2. Update `package.json` with your project details
3. Configure Orval for your Umbraco add-on's OpenAPI spec
4. Add your tool collections

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
│   └── mcp-server-sdk/    # @umbraco-cms/mcp-server-sdk (npm package)
│       ├── src/
│       │   ├── helpers/   # Tool result, API call, decorators
│       │   ├── config/    # Collection/slice/mode configuration
│       │   ├── testing/   # Snapshot normalization, test setup
│       │   ├── evals/     # LLM-based acceptance testing
│       │   └── types/     # Tool and collection types
│       └── package.json
│
├── template/              # Starter kit (not published)
│   ├── src/
│   │   └── tools/
│   ├── __tests__/
│   └── package.json
│
└── package.json           # Monorepo root
```

## License

MIT
