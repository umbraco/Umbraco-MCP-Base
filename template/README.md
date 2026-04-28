# My Umbraco MCP Server

MCP server template for Umbraco add-ons using the @umbraco-cms/mcp-server-sdk.

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your Umbraco connection details:

```bash
cp .env.example .env
```

### 3. Generate API Client (Optional)

If you have an OpenAPI spec for your add-on:

1. Update `orval.config.ts` to point to your spec
2. Run the generator:

```bash
npm run generate
```

### 4. Build and Test

```bash
# Build the server
npm run build

# Run tests
npm test

# Test with MCP Inspector
npm run inspect
```

## Project Structure

```
├── src/
│   ├── api/
│   │   ├── client.ts           # API client configuration
│   │   └── generated/          # Orval-generated API code
│   ├── tools/
│   │   └── example/            # Example tool collection
│   │       ├── get/
│   │       ├── post/
│   │       └── index.ts
│   └── index.ts                # Server entry point
├── scripts/
│   └── tunnels.sh              # Cloudflare tunnels for remote MCP client testing
├── umbraco/
│   └── McpOAuthComposer.cs     # OAuth client registration (copy into your Umbraco project)
├── __tests__/
│   └── example/                # Example tests
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── jest.config.ts
├── orval.config.ts
└── .env.example
```

## Adding Your Own Tools

1. Create a new folder under `src/tools/` for your tool collection
2. Create tool files following the example pattern:
   - `get/` for GET operations
   - `post/` for POST operations
   - `put/` for PUT operations
   - `delete/` for DELETE operations
3. Create an `index.ts` that exports the collection
4. Register the collection in `src/index.ts`

### Tool Pattern Example

```typescript
import { z } from "zod";
import {
  withStandardDecorators,
  executeGetApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";

const inputSchema = {
  id: z.string().uuid(),
};

const myTool: ToolDefinition<typeof inputSchema> = {
  name: "my-tool",
  description: "Does something useful",
  inputSchema,
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async ({ id }) => {
    return executeGetApiCall((client) =>
      client.getMyItem(id, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(myTool);
```

## Testing

Tests use Jest with the MCP toolkit's testing helpers:

```typescript
import {
  setupTestEnvironment,
  createSnapshotResult,
  createMockRequestHandlerExtra,
} from "@umbraco-cms/mcp-server-sdk/testing";

describe("my-tool", () => {
  setupTestEnvironment();

  it("should do something", async () => {
    const result = await myTool.handler({ id: "..." }, createMockRequestHandlerExtra());
    expect(createSnapshotResult(result)).toMatchSnapshot();
  });
});
```

## Testing with Claude Code

This project ships with a `.mcp.json` that registers the MCP server with Claude Code automatically. Once you have run `init`, `discover`, and `npm run build`, open the project directory in Claude Code and the server is available immediately — no manual `claude mcp add` required.

```bash
# One-time setup
npx @umbraco-cms/create-umbraco-mcp-server init   # writes credentials to .env
npx @umbraco-cms/create-umbraco-mcp-server discover # generates API client
npm run build                                       # compiles dist/index.js

# Open in Claude Code — .mcp.json is picked up automatically
claude .
```

The server reads credentials from `.env` via `node --env-file=.env ./dist/index.js`, so no secrets are committed to source control.

## Publishing

1. Update `package.json` with your package name and details
2. Build: `npm run build`
3. Publish: `npm publish`

## License

MIT
