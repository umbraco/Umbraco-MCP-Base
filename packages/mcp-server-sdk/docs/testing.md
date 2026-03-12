# Testing & Evals Guide

How to test tools at each level: unit/integration tests and LLM evals.

## Unit/Integration Testing

Import from `@umbraco-cms/mcp-server-sdk/testing`.

### Test Environment Setup

```typescript
import { setupTestEnvironment, setupMswServer } from "@umbraco-cms/mcp-server-sdk/testing";
import { setupServer } from "msw/node";
import { handlers, resetStore } from "./handlers.js";

// Mocks console.error in beforeEach/afterEach to keep test output clean
setupTestEnvironment();

// MSW server for API mocking
const mswServer = setupServer(...handlers);
setupMswServer(mswServer, resetStore, { onUnhandledRequest: "error" });
```

`setupTestEnvironment()` sets up `beforeEach`/`afterEach` hooks that mock `console.error` to suppress expected error output during tests.

`setupMswServer(server, resetStore?, options?)` sets up `beforeAll`/`afterAll`/`afterEach` hooks for MSW lifecycle. The optional `resetStore` callback runs after each test to reset any in-memory state.

### Testing a Tool Handler

```typescript
import { createMockRequestHandlerExtra, getResultText, getStructuredContent } from "@umbraco-cms/mcp-server-sdk/testing";
import myTool from "../get/my-tool.js";

describe("my-tool", () => {
  it("returns item data", async () => {
    const extra = createMockRequestHandlerExtra();
    const result = await myTool.handler({ id: "abc-123" }, extra);

    // Check text content
    const text = getResultText(result);
    expect(text).toContain("abc-123");

    // Check structured content
    const data = getStructuredContent(result);
    expect(data).toHaveProperty("name");
  });
});
```

### Result Helpers

| Function | Description |
|----------|-------------|
| `getResultText(result)` | Extracts text from the first text content block |
| `getStructuredContent(result)` | Returns `result.structuredContent` |
| `validateStructuredContent(result, schema)` | Parses structured content against a Zod schema, throws on mismatch |
| `validateErrorResult(result)` | Validates error result matches ProblemDetails shape |
| `validateToolResponse(tool, result)` | Validates result against the tool's `outputSchema` |

### Snapshot Helpers

For snapshot testing with stable output (normalizes UUIDs and timestamps):

```typescript
import { createSnapshotResult, normalizeErrorResponse } from "@umbraco-cms/mcp-server-sdk/testing";

it("matches snapshot", async () => {
  const result = await myTool.handler({ id: knownId }, extra);

  // Replaces knownId with "[normalized-id]" and normalizes other UUIDs
  const snapshot = createSnapshotResult(result, knownId);
  expect(snapshot).toMatchSnapshot();
});

it("error matches snapshot", async () => {
  const result = await myTool.handler({ id: "nonexistent" }, extra);
  const normalized = normalizeErrorResponse(result);
  expect(normalized).toMatchSnapshot();
});
```

`normalizeObject(obj, idToReplace?, normalizeIdRefs?)` — lower-level normalizer that replaces UUIDs, dates, and other volatile values with stable placeholders.

### Mock Handler Extra

`createMockRequestHandlerExtra()` creates the `extra` context object that tool handlers receive as their second argument. Provides mock implementations of MCP server request/notification methods.

## LLM Evals

Import from `@umbraco-cms/mcp-server-sdk/evals`. Tests run an actual LLM agent against your MCP server.

### Configuration

```typescript
// test-setup.ts (or jest.setup.ts)
import { configureEvals } from "@umbraco-cms/mcp-server-sdk/evals";

configureEvals({
  mcpServerPath: "./dist/index.js",
  mcpServerName: "my-umbraco-mcp",
  serverEnv: {
    UMBRACO_BASE_URL: "http://localhost:44391",
    UMBRACO_CLIENT_ID: "test-client",
    UMBRACO_CLIENT_SECRET: "test-secret",
  },
  defaultModel: "claude-haiku-4-5-20251001",
  defaultMaxTurns: 5,
  defaultMaxBudgetUsd: 0.50,
  defaultTimeoutMs: 60000,
  defaultVerbosity: "quiet",
});
```

### `runScenarioTest(scenario)`

Returns a Jest test function. Use inside `it()`:

```typescript
import { runScenarioTest } from "@umbraco-cms/mcp-server-sdk/evals";

describe("Document tools", () => {
  it(
    "can retrieve a document by name",
    runScenarioTest({
      prompt: "Find the document named 'Home' and return its ID",
      tools: ["get-document", "search-documents"],
      requiredTools: ["search-documents"],
      successPattern: /found|home/i,
    }),
    60000  // timeout
  );
});
```

### TestScenario Type

```typescript
interface TestScenario {
  name: string;                          // Test name (for logging)
  prompt: string;                        // What to ask the LLM
  tools: string | string[];              // Which tools to make available
  requiredTools: string[];               // Tools that must be called (verification)
  successPattern?: RegExp | string;      // Pattern to match in final response
  verbose?: boolean;                     // Enable verbose logging
  verbosity?: "quiet" | "normal" | "verbose";
  options?: AgentTestOptions;            // Override defaults
}
```

### `runAgentTest(prompt, tools, options?)`

Lower-level: runs the agent and returns the full result for manual verification.

```typescript
import { runAgentTest } from "@umbraco-cms/mcp-server-sdk/evals";

const result = await runAgentTest(
  "List all document types",
  ["list-document-types"],
  { maxTurns: 3, verbose: true }
);

console.log(result.toolCalls);    // What tools were called
console.log(result.finalResult);  // LLM's final text response
console.log(result.cost);         // API cost in USD
console.log(result.tokens);       // { input, output, total }
```

### AgentTestResult

```typescript
interface AgentTestResult {
  toolCalls: ToolCall[];         // All tool calls made
  toolResults: unknown[];        // Results from each call
  finalResult: string;           // LLM's final text response
  success: boolean;              // Whether the agent completed
  cost: number;                  // API cost in USD
  turns: number;                 // Number of turns taken
  availableTools: string[];      // Tools that were available
  tokens: { input: number; output: number; total: number };
}
```

### Verification Helpers

```typescript
import {
  verifyRequiredToolCalls,
  verifySuccessMessage,
  verifyMcpConnection,
  verifyToolsAvailable,
  verifyToolCalledWithParams,
  assertTestPassed,
} from "@umbraco-cms/mcp-server-sdk/evals";

// Check required tools were called
const { passed, missing, called } = verifyRequiredToolCalls(
  result.toolCalls,
  ["search-documents", "get-document"]
);

// Check final response matches pattern
const messageOk = verifySuccessMessage(result.finalResult, /found/i);

// Check MCP connection was established (tools were available)
const connected = verifyMcpConnection(result);

// Check specific tools were available
const { passed, missing } = verifyToolsAvailable(result, ["get-document"]);

// Check a tool was called with specific params
const calledCorrectly = verifyToolCalledWithParams(
  result.toolCalls,
  "get-document",
  { id: "expected-id" }
);

// All-in-one assertion (throws on failure)
assertTestPassed(result, ["search-documents"], {
  requireSuccessMessage: true,
  customSuccessPattern: /found/i,
  logOnFailure: true,
});
```

### Claude Models

```typescript
import { ClaudeModels } from "@umbraco-cms/mcp-server-sdk/evals";

ClaudeModels.Haiku;   // "claude-haiku-4-5-20251001"
ClaudeModels.Sonnet;  // "claude-sonnet-4-5-20250929"
ClaudeModels.Opus;    // "claude-opus-4-6"
```

## Reference

| Source File | Contains |
|-------------|----------|
| `src/testing/test-environment.ts` | `setupTestEnvironment`, `setupMswServer` |
| `src/testing/mock-handler.ts` | `createMockRequestHandlerExtra`, `getResultText`, `getStructuredContent`, validators |
| `src/testing/snapshot-result.ts` | `createSnapshotResult`, `normalizeErrorResponse`, `normalizeObject` |
| `src/evals/config.ts` | `configureEvals`, `getEvalConfig`, `ClaudeModels` |
| `src/evals/scenario-runner.ts` | `runScenarioTest` |
| `src/evals/agent-runner.ts` | `runAgentTest` |
| `src/evals/verification.ts` | All `verify*` helpers, `assertTestPassed` |
| `src/evals/types.ts` | `TestScenario`, `AgentTestResult`, `ToolCall` |
