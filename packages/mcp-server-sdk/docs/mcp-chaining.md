# MCP Chaining, Proxying & Composite Tools

Connect multiple MCP servers together. Three patterns, each for different use cases.

## Setup

### 1. Configure Servers

Two transport types are available:

**Stdio** — spawns a child process (Node.js environments):

```typescript
import type { McpServerConfig } from "@umbraco-cms/mcp-server-sdk";

export const mcpServers: McpServerConfig[] = [
  {
    name: "cms",
    command: "npx",
    args: ["-y", "@umbraco-cms/mcp-dev@17"],
    env: {
      UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL || "",
      UMBRACO_CLIENT_ID: process.env.UMBRACO_CLIENT_ID || "",
      UMBRACO_CLIENT_SECRET: process.env.UMBRACO_CLIENT_SECRET || "",
    },
    proxyTools: true,
  },
];
```

**In-process** — calls tool handlers directly, no child process (works in Cloudflare Workers and other restricted environments):

```typescript
import type { McpServerConfig } from "@umbraco-cms/mcp-server-sdk";
import { devCollections } from "./dev-collections.js";

export const mcpServers: McpServerConfig[] = [
  {
    transport: "in-process",
    name: "dev",
    collections: devCollections,
    user: currentUser,           // Optional: passed to collection.tools(user)
    modeRegistry: myModes,       // Optional: for mode-based filtering
    allModeNames: ["content"],   // Optional: valid mode names
    proxyTools: true,
  },
];
```

### 2. Create the Client Manager

```typescript
import { createMcpClientManager } from "@umbraco-cms/mcp-server-sdk";
import { mcpServers } from "../config/mcp-servers.js";

export const mcpClientManager = createMcpClientManager({
  filterConfig: { slices: ["read", "list"] },  // Optional: filters apply to both transports
});

for (const config of mcpServers) {
  mcpClientManager.registerServer(config);
}
```

The same consumer code works regardless of transport:

```typescript
const result = await mcpClientManager.callTool("cms", "get-document", { id });
const { tools } = await mcpClientManager.listTools("dev");
```

### 3. Register Proxied Tools (in entry point)

```typescript
import { discoverProxiedTools, parseProxiedToolName } from "@umbraco-cms/mcp-server-sdk";
import { mcpClientManager } from "./umbraco-api/mcp-client.js";

const proxiedTools = await discoverProxiedTools(mcpClientManager);

for (const pt of proxiedTools) {
  server.registerTool(
    pt.prefixedName,  // e.g., "cms:get-document"
    {
      description: `[Proxied from ${pt.serverName}] ${pt.originalTool.description || ""}`,
    },
    async (args) => {
      const { serverName, toolName } = parseProxiedToolName(pt.prefixedName);
      return await mcpClientManager.callTool(serverName, toolName, args);
    }
  );
}
```

### 4. Cleanup on Shutdown

```typescript
process.on("SIGINT", async () => {
  await mcpClientManager.disconnectAll();
  process.exit(0);
});
```

## Pattern 1: Proxying

Expose chained server tools directly to the LLM client. Tools appear with a `server:tool-name` prefix.

**When to use:** You want the LLM to have direct access to another server's tools without any transformation.

```
LLM → your server → chained server (cms:get-document)
                  ← result passed through
```

Set `proxyTools: true` in the server config and use `discoverProxiedTools()` as shown above. The LLM sees tools like `cms:get-document`, `cms:list-documents`, etc.

### Proxy Utilities

```typescript
import { isProxiedToolName, parseProxiedToolName } from "@umbraco-cms/mcp-server-sdk";

isProxiedToolName("cms:get-document");  // true
isProxiedToolName("local-tool");        // false

parseProxiedToolName("cms:get-document");
// { serverName: "cms", toolName: "get-document" }
```

## Pattern 2: Delegation

Call chained tools from within your own tool handler. The LLM doesn't see the chained tool directly.

**When to use:** Your tool needs data from another server as part of its logic.

```typescript
import { mcpClientManager } from "../../mcp-client.js";

handler: async ({ documentId }) => {
  // Call a tool on the "cms" server
  const result = await mcpClientManager.callTool("cms", "get-document", {
    id: documentId,
  });

  // Extract structured content (preferred)
  const document = result.structuredContent;

  // Or extract text content (fallback)
  const textContent = result.content?.find(c => c.type === "text");
  const data = textContent ? JSON.parse(textContent.text) : null;

  // Use the data in your tool's logic
  return createToolResult({ enhanced: true, document });
}
```

## Pattern 3: Composite Tools

Local tools that orchestrate multiple chained calls, adding business logic, validation, or aggregation.

**When to use:** You're combining data from multiple sources or adding value beyond what individual chained tools provide.

```typescript
const syncContentTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "sync-content",
  description: "Syncs content between CMS and external system",
  inputSchema,
  outputSchema,
  slices: ["update"],
  annotations: { idempotentHint: true },
  handler: async ({ documentId, targetSystem }) => {
    // 1. Get content from CMS
    const cmsResult = await mcpClientManager.callTool("cms", "get-document", {
      id: documentId,
    });
    const document = cmsResult.structuredContent;

    // 2. Get status from external system
    const externalResult = await mcpClientManager.callTool("external", "get-sync-status", {
      externalId: document.externalId,
    });

    // 3. Business logic
    if (externalResult.structuredContent?.lastSync > document.updateDate) {
      return createToolResult({ status: "already-synced" });
    }

    // 4. Push update
    await mcpClientManager.callTool("external", "update-content", {
      externalId: document.externalId,
      content: document,
    });

    return createToolResult({ status: "synced", documentId });
  },
};
```

## Transports

### Stdio Transport

Default transport. Spawns the MCP server as a child process and communicates via stdin/stdout. Requires `node:child_process`.

- Filter passthrough: filters are appended as CLI args (`--tools`, `--slices`, `--modes`, `--tool-collections`)
- Connection: lazy on first `callTool` or `listTools` call
- Disconnection: terminates the child process

### In-Process Transport

Calls tool handlers directly in the same process. No child process, no Node.js APIs required.

- Filter passthrough: filters are applied directly using the SDK's `shouldIncludeTool` + `createCollectionConfigLoader`
- Zod inputSchemas are converted to JSON Schema via `z.toJSONSchema()` for `listTools()`
- Tool handlers receive a minimal stub context (no notifications or request forwarding)
- `close()` is a no-op

Use this when:
- Running in Cloudflare Workers or other environments without `node:child_process`
- You want to avoid the overhead of spawning a child process
- The tool collections are already available in the same codebase

### InProcessConnection (Direct Use)

You can also use `InProcessConnection` directly without the manager:

```typescript
import { InProcessConnection } from "@umbraco-cms/mcp-server-sdk";

const connection = new InProcessConnection({
  transport: "in-process",
  name: "dev",
  collections: myCollections,
  user: currentUser,
});

const { tools } = await connection.listTools();
const result = await connection.callTool("get-document-type", { id });
```

## McpClientManager API

| Method | Description |
|--------|-------------|
| `registerServer(config)` | Register a server config (does not connect yet) |
| `connect(serverName)` | Explicitly connect (usually automatic on first call) |
| `callTool(serverName, toolName, args)` | Call a tool on a chained server |
| `listTools(serverName)` | List available tools on a server |
| `hasServer(serverName)` | Check if a server is registered |
| `isConnected(serverName)` | Check if a server is currently connected |
| `disconnect(serverName)` | Disconnect from a specific server |
| `disconnectAll()` | Disconnect from all servers |
| `getConfigs()` | Get all registered server configs |

## McpServerConfig

Discriminated union — use the `transport` field to select the connection type.

```typescript
// Stdio (default when transport is omitted)
interface McpStdioServerConfig {
  transport?: "stdio";
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  proxyTools?: boolean;
}

// In-process (direct handler calls)
interface McpInProcessServerConfig {
  transport: "in-process";
  name: string;
  collections: ToolCollectionExport[];
  user?: unknown;
  modeRegistry?: ToolModeDefinition[];
  allModeNames?: readonly string[];
  allSliceNames?: readonly string[];
  proxyTools?: boolean;
}

type McpServerConfig = McpStdioServerConfig | McpInProcessServerConfig;
```

## Reference

| Source File | Contains |
|-------------|----------|
| `src/mcp-client/manager.ts` | `McpClientManager`, `createMcpClientManager` |
| `src/mcp-client/stdio-connection.ts` | `StdioConnection` — stdio transport implementation |
| `src/mcp-client/in-process-connection.ts` | `InProcessConnection` — in-process transport implementation |
| `src/mcp-client/proxy.ts` | `discoverProxiedTools`, `parseProxiedToolName`, `isProxiedToolName` |
| `src/mcp-client/types.ts` | `McpServerConfig`, `McpConnection`, `McpClientOptions`, `FilterConfig` |
