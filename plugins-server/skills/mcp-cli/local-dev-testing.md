# Local Development Testing

When developing an MCP server or the SDK itself, you can test the CLI directly inside Claude Code without publishing or installing anything.

## Finding the MCP server to test

The MCP server project may not be your current working directory. Before running CLI commands:

1. Check if the current directory has a `dist/index.js` and a `.env` file
2. If not, **use AskUserQuestion** to ask the user for the path to the MCP server project they want to test
3. Use absolute paths or `cd` to the server project directory when running commands

## Prerequisites

1. **Build the project** — the CLI runs from `dist/index.js`, so you must build first:
   ```bash
   npm run build
   ```
2. **Umbraco instance running** — needed for full tool listing (with auth) and for running the MCP server
3. **`.env` file** — credentials are loaded automatically from `.env` in the MCP server project root

## Testing introspection commands

Run these from the MCP server project directory:

```bash
# List all tools (uses .env for auth)
node dist/index.js --list-tools

# Describe a specific tool
node dist/index.js --describe-tool get-document-by-id

# Generate context file
node dist/index.js --generate-context > CONTEXT.md
```

Or with an explicit path from any directory:

```bash
node /path/to/mcp-server/dist/index.js --env /path/to/mcp-server/.env --list-tools
```

## Testing with a linked SDK

When testing SDK changes against an MCP server project, symlink the local SDK:

```bash
# From the SDK monorepo — register the package globally
npm link -w packages/mcp-server-sdk

# From the MCP server project — replace installed SDK with symlink
rm -rf node_modules/@umbraco-cms/mcp-server-sdk
ln -s /path/to/umbraco-mcp-base/packages/mcp-server-sdk node_modules/@umbraco-cms/mcp-server-sdk

# Rebuild both SDK and server, then test
npm run build  # in SDK repo
npm run build  # in server project
node dist/index.js --list-tools
```

## Integrating handleCliCommands

To add CLI introspection to an MCP server, call `handleCliCommands` after authentication so the real user is available for tool filtering:

```typescript
import { getServerConfig, handleCliCommands } from "@umbraco-cms/mcp-server-sdk";

// ... authenticate and get user ...

const rawConfig = await getServerConfig(true);
handleCliCommands(collections, {
  cliFlags: rawConfig.cliFlags,
  serverName: "My MCP Server",
  serverVersion: packageJson.version,
  user, // pass the authenticated user for full tool visibility
});
```

If called without a user, collections that throw on missing user data are safely skipped.
