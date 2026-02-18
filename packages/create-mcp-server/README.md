# @umbraco-cms/create-umbraco-mcp-server

Scaffold a new Umbraco MCP server project.

## Usage

```bash
# With project name
npx @umbraco-cms/create-umbraco-mcp-server My-Umbraco-MCP

# Interactive mode
npx @umbraco-cms/create-umbraco-mcp-server

# Also works with npm create
npm create @umbraco-cms/umbraco-mcp-server My-Umbraco-MCP
```

## What it does

Creates a new directory with a fully configured Umbraco MCP server project:

- Pre-configured TypeScript and build tooling
- Orval setup for API client generation
- Testing infrastructure (unit tests and LLM evals)
- MSW mocking for API tests
- Tool filtering configuration

## After scaffolding

```bash
cd My-Umbraco-MCP
npm install
npm run build
```

## Customizing exclusions

To exclude additional files from scaffolded projects, edit `src/exclusions.ts` before building:

```typescript
export const SCAFFOLD_EXCLUSIONS = [
  // ... existing exclusions ...

  // Add new exclusions here:
  'src/path/to/remove/',
  'some-file.ts',
];
```
