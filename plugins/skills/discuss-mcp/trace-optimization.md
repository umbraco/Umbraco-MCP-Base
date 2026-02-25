# Trace Optimization

Structured approach for analyzing eval traces and iteratively improving MCP tools based on LLM behavior data.

## Trace Data Explained

When evals run, `AgentTestResult` captures everything the LLM did:

| Field | What It Tells You |
|-------|-------------------|
| `toolCalls` | Every tool the LLM called, with input parameters |
| `toolResults` | What each tool returned |
| `finalResult` | The LLM's final text response |
| `success` | Whether the agent completed without error |
| `cost` | Total USD spent on the scenario |
| `turns` | Number of conversation round-trips |
| `tokens` | Input, output, and total token counts |
| `availableTools` | Which tools were exposed to the LLM |

**Verbose mode** (`E2E_VERBOSITY=verbose`) adds the full conversation trace: assistant reasoning between tool calls, exact tool inputs, and tool result previews (truncated at 500 chars). This is where the real diagnostic insight lives — you can see *why* the LLM made each decision.

**Key source files:**
- `packages/mcp-server-sdk/src/evals/types.ts` — `AgentTestResult`, `ToolCall`, `TestScenario` interfaces
- `packages/mcp-server-sdk/src/evals/agent-runner.ts` — `runAgentTest()`, `logTestResult()`, verbose output format

## Diagnostic Checklist

When reviewing eval traces, look for these signals:

### High Turns (scenario takes more round-trips than expected)

| Signal | Interpretation | Potential Fix |
|--------|---------------|---------------|
| 5+ turns for a single-tool task | LLM struggling to understand the tool | Improve tool description clarity |
| LLM tries wrong tool first, then corrects | Similar tool names or descriptions | Differentiate names and descriptions |
| LLM calls tool correctly but misreads result | Response schema too complex | Simplify output, remove unused fields |
| LLM asks clarifying questions mid-task | Prompt or tool description ambiguous | Add usage examples to description |

### Repeated Tool Calls

| Signal | Interpretation | Potential Fix |
|--------|---------------|---------------|
| Same tool called 3+ times with different params | LLM retrying after failures | Check error messages — are they actionable? |
| List tool called repeatedly with offsets | Pagination confusion | Improve pagination description or add search tool |
| Same tool called with identical params | LLM didn't understand the result | Simplify response or improve description of output |

### Wrong Tool Selection

| Signal | Interpretation | Potential Fix |
|--------|---------------|---------------|
| LLM picks `get-X-by-id` when it needs `list-X` | Descriptions don't differentiate clearly | Make the distinction explicit: "retrieves a single item by its unique ID" vs "retrieves a paginated list" |
| LLM picks a tool from the wrong collection | Collection/tool naming overlap | Add collection context to descriptions |
| LLM invents a tool that doesn't exist | Expected capability is missing | Consider adding the missing tool |

### High Cost / Token Usage

| Signal | Interpretation | Potential Fix |
|--------|---------------|---------------|
| High input tokens, few turns | Large tool responses bloating context | Trim response schemas — remove fields the LLM doesn't need |
| High output tokens | LLM generating verbose reasoning | Tool descriptions may be unclear, forcing extended reasoning |
| Cost scales with number of tools available | Too many tools exposed | Use slices/modes to filter down to relevant tools |

### Extensive Reasoning Between Calls

| Signal | Interpretation | Potential Fix |
|--------|---------------|---------------|
| Long reasoning blocks about which tool to pick | Tool descriptions don't guide selection | Add "Use this when..." phrasing to descriptions |
| Reasoning about how to map input params | Parameter names or descriptions unclear | Rename params or improve `.describe()` text |
| Reasoning about how to interpret results | Output structure unclear | Add description of what the output represents |

## The Self-Improvement Loop

A structured workflow for iteratively improving tools based on eval data:

### Step 1: Run Evals with Verbose Output

```bash
E2E_VERBOSITY=verbose npm run test:evals 2>&1 | tee eval-output.log
```

Or run a single collection's evals:

```bash
E2E_VERBOSITY=verbose npm run test:evals -- --testPathPattern="{collection}" 2>&1 | tee eval-output.log
```

### Step 2: Analyze Traces

Run the analysis script to get structured metrics:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discuss-mcp/scripts/analyze-traces.ts
```

Or from a saved log file:

```bash
LOG_FILE=eval-output.log npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discuss-mcp/scripts/analyze-traces.ts
```

The script parses `logTestResult()` output and surfaces:
- Per-scenario metrics (turns, cost, tokens, success)
- Repeated tool call patterns
- High-turn outliers
- Tool usage frequency

### Step 3: Identify Improvement Opportunities

Use the diagnostic checklist above against the trace data. Focus on:
- **Failing scenarios first** — these are broken workflows
- **High-turn scenarios** — these are working but inefficient
- **High-cost scenarios** — these may indicate bloated responses

### Step 4: Discuss Findings

Present the findings to the developer with concrete evidence:
- Quote the specific tool calls and reasoning from verbose output
- Reference specific tool files and descriptions
- Propose changes with trade-offs (see Common Improvement Patterns below)

### Step 5: Plan and Execute

When a concrete improvement is agreed:
1. **Enter plan mode** to design the change
2. Get developer approval
3. Execute the changes (edit tool descriptions, simplify schemas, add composite tools, etc.)

### Step 6: Rebuild and Re-run

```bash
npm run build && E2E_VERBOSITY=verbose npm run test:evals 2>&1 | tee eval-output-v2.log
```

### Step 7: Compare Before/After

Run analysis on both log files and compare:
- Did turns decrease for the target scenario?
- Did cost go down?
- Did success rate stay at 100%?
- Did fixing one scenario break another?

### Step 8: Iterate or Stop

If further improvements are possible, go back to Step 3. Stop when:
- All scenarios pass
- Turn counts are reasonable for the task complexity
- Cost is acceptable
- No obvious inefficiencies remain in traces

## Common Improvement Patterns

### Description Improvements

The highest-impact, lowest-risk change. Better descriptions guide the LLM without changing any behavior.

**Before:** `"Gets a document"` — LLM doesn't know when to use this vs. list-documents.
**After:** `"Retrieves a single document by its unique ID. Returns the document's properties, content, and metadata. Use list-documents to find documents by name or path."` — Clear scope and cross-reference.

### Schema Simplification

Remove response fields the LLM doesn't need. Large objects with nested arrays bloat context.

**Trade-off:** Simpler responses reduce tokens but may omit data that some workflows need. Check eval scenarios to see which fields are actually used.

### Composite Tool Bundling

When the LLM always calls tools A → B → C in sequence, consider a composite that does all three.

**Trade-off:** Reduces turns but creates bespoke tools that are harder to maintain. Only worthwhile if the pattern appears in multiple eval scenarios.

### Response Trimming

Some API responses include metadata, pagination wrappers, or internal IDs that the LLM never uses. Stripping these in the tool handler reduces token usage.

**Trade-off:** Must be careful not to remove data needed by other scenarios. Review all evals that use the tool.

## Metrics Framework

Track these metrics per scenario across improvement iterations:

| Metric | Target | Red Flag |
|--------|--------|----------|
| Turns | 1-3 for simple tasks, 3-6 for multi-step | >6 for any single-tool task |
| Cost | < $0.05 per scenario | > $0.10 per scenario |
| Tokens | Proportional to response size | Input tokens growing across turns (context bloat) |
| Success | 100% for all scenarios | Any failure indicates regression |

Keep a log of changes and their metric impact to build intuition for what works.
