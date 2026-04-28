# Chained Tool Design

Discussion framework for deciding when and how to add tools that delegate to other MCP servers — proxy passthrough vs. composite tools with business logic.

## Two Patterns: Proxy vs Composite

### Proxy Tools

Transparent passthrough: tools from a chained server are automatically discovered and exposed with a prefix (`{serverName}:{toolName}`). No local code needed.

**How it works:**
- Set `proxyTools: true` in `src/config/mcp-servers.ts`
- `discoverProxiedTools()` lists tools from the chained server
- Each tool appears to the LLM as `{serverName}:{toolName}` (e.g., `cms:get-document`)
- Descriptions are prefixed with `[Proxied from {serverName}]`
- Calls are forwarded via `createProxyHandler()` — zero transformation

**Key source files:**
- `packages/mcp-server-sdk/src/mcp-client/proxy.ts` — `discoverProxiedTools()`, `createProxyHandler()`, `proxiedToolsToDefinitions()`
- `src/config/mcp-servers.ts` — server chain configuration

### Composite Tools

Local tool that calls one or more tools on chained servers, adding business logic, aggregation, or transformation.

**How it works:**
- Import `mcpClientManager` from `../../mcp-client.js`
- Call `mcpClientManager.callTool(serverName, toolName, args)` inside the handler
- Extract data from `result.structuredContent` (preferred) or parse `result.content[].text` (legacy)
- Add local logic: aggregation, validation, transformation, enrichment
- Return combined result via `createToolResult()`

**Key source file:**
- `template/src/umbraco-api/tools/chained/get-chained-info.ts` — working composite example

## Gathering Data

Before discussing chained tool design, discover what tools the chained servers offer:

### List Chained Server Tools

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discuss-mcp/scripts/list-chained-tools.ts
```

To include input schemas (useful for understanding tool capabilities):

```bash
SHOW_SCHEMAS=true npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discuss-mcp/scripts/list-chained-tools.ts
```

This imports the project's `src/config/mcp-servers.ts`, connects to each configured server, and lists all available tools. Use this to understand:
- What building blocks are available for composite tools
- Whether proxy tools cover the needed functionality or composites would add value
- What multi-tool patterns could be simplified into single composite tools

## Decision Framework

Use this to decide which pattern fits:

| Scenario | Pattern | Why |
|----------|---------|-----|
| Expose a chained server's tools with no changes | **Proxy** | Zero code, automatic discovery |
| Combine data from two chained servers | **Composite** | Proxy can't aggregate across servers |
| Add validation before calling a chained tool | **Composite** | Proxy forwards blindly |
| Filter or transform chained tool responses | **Composite** | Proxy returns raw results |
| Multi-step workflow (call A, use result in B) | **Composite** | Proxy has no sequencing logic |
| Simple exposure with consistent naming | **Proxy** | Naming is automatic and consistent |
| Need custom input schema different from chained tool | **Composite** | Proxy preserves original schema |

**Rule of thumb:** Start with proxy. Switch to composite only when you need logic that proxy can't express.

## Design Discussion Questions

When a developer is considering adding chained tools, work through these:

1. **What workflow are you supporting?** Describe the end-to-end task the LLM needs to accomplish. This reveals whether proxy or composite is needed.

2. **What tools would the LLM need to call today?** If the answer is "just one tool from the other server", proxy is likely enough. If it's "tool A, then use A's result to call tool B", that's composite territory.

3. **Is ordering critical?** If tools must be called in a specific sequence, composite enforces it. Proxy leaves sequencing to the LLM (which may get it wrong).

4. **How should errors be handled?** Proxy surfaces raw errors from the chained server. Composite can retry, provide fallbacks, or return partial results.

5. **Does the LLM need all the chained server's tools?** Proxy exposes everything (filterable via slices/modes). If only a subset is relevant, consider whether filtering is sufficient or if a composite that bundles the right calls is clearer.

## Implementation Patterns

### Extracting Structured Content from `callTool`

```typescript
// Preferred: structured content (tool has outputSchema)
const result = await mcpClientManager.callTool("cms", "get-document", { id });
const document = result.structuredContent;

// Fallback: parse text content (older tools)
const textContent = result.content?.find(c => c.type === "text");
const document = textContent ? JSON.parse(textContent.text) : null;
```

### Error Handling in Composites

```typescript
handler: async ({ id }) => {
  const result = await mcpClientManager.callTool("cms", "get-document", { id });

  // Check for error responses
  const errorContent = result.content?.find(c => c.type === "text" && c.text?.includes("error"));
  if (result.isError || errorContent) {
    return createToolResultError(`Failed to get document: ${errorContent?.text ?? "Unknown error"}`);
  }

  return createToolResult({ ... });
}
```

### Multi-Server Aggregation

```typescript
handler: async ({ query }) => {
  // Call tools on different servers in parallel
  const [documents, media] = await Promise.all([
    mcpClientManager.callTool("cms", "search-documents", { query }),
    mcpClientManager.callTool("cms", "search-media", { query }),
  ]);

  return createToolResult({
    documents: documents.structuredContent,
    media: media.structuredContent,
    totalResults: /* combined count */,
  });
}
```

### Testing Composites

Composites that call chained servers need the mock chain server for tests:

```typescript
// In mcp-servers.ts, USE_MOCK_MCP_CHAIN=true switches to mock server
// The mock server is at src/testing/mock-mcp-server.ts
// Integration tests set this env var automatically
```

For evals, the real chained server must be available (or mocked via the test configuration).

## Trade-Off Discussion Points

Use these when advising on chained tool design:

### Proxy Proliferation

**Problem:** A chained server exposes 50+ tools. Proxying all of them floods the LLM's tool list, increasing cost and reducing selection accuracy.

**Mitigations:**
- Use slice filtering (`UMBRACO_INCLUDE_SLICES=read,list`) to expose only relevant operations
- Use mode filtering to group tools by workflow
- Consider composite tools that bundle common multi-tool patterns

### Composite Complexity

**Problem:** Every composite is bespoke code that must handle errors, extract results, and maintain its own schema. This adds maintenance burden.

**Mitigations:**
- Only create composites for patterns that appear in multiple eval scenarios
- Keep composites thin — delegate logic to the chained tools, only add coordination
- Write evals that test the composite workflow end-to-end

### Version Coupling

**Problem:** Composites depend on specific tool names and schemas from the chained server. If the chained server updates, composites may break.

**Mitigations:**
- Use `structuredContent` extraction (schema-aware) rather than text parsing
- Pin chained server versions in `mcp-servers.ts` args
- Run evals after chained server updates to catch regressions

### Filter Inheritance

**Problem:** Chained servers receive the same filter configuration as the parent. This may not be appropriate — the parent's slice filters may not map to the chained server's slice names.

**Mitigations:**
- Review the chained server's slice and mode registries
- Consider per-server filter overrides if the SDK supports them
- Document which filters affect chained tool availability
