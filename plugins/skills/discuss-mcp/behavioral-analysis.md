# Behavioral Analysis

Holistic review of an MCP server: what it covers, how it's organized, what's missing, and what to build next. Distinct from `/count-mcp-tools` which reports numbers — this skill interprets them with recommendations and prioritization.

## Gathering Data

Before analyzing, collect the facts:

### 1. Run Count Tools

Reuse the existing count-tools script for raw data:

```bash
SHOW_TOOLS=true npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts
```

This provides: tool counts by collection, gap analysis against `.discover.json`, endpoint coverage percentages, test and eval status.

### 2. Read Discovery Manifest

Read `.discover.json` in the project root for the declared API scope: which collections are expected, the Swagger URL, and base URL.

### 3. Read Registries

- `src/config/slice-registry.ts` — what slices are defined (CRUD categories, tree, search, publish, etc.)
- `src/config/mode-registry.ts` — what modes exist and which collections they map to

### 4. Read Ignored Endpoints

Read `docs/analysis/IGNORED_ENDPOINTS.md` if it exists. This file lists API endpoints that have been **deliberately excluded** from the MCP server — they are not gaps to fill. Common reasons: security implications, import/export functionality unsuitable for MCP, deprecated endpoints, or endpoints with better alternatives.

**Never suggest building tools for ignored endpoints.** These are settled decisions. If the file doesn't exist, the project hasn't categorized its ignored endpoints yet — suggest running `/update-ignored-endpoints` first.

### 5. Read Tool Descriptions

Skim key tool files to assess description quality. Look at the `name`, `description`, `slices`, and `annotations` fields.

**Key source files:**
- `plugins/skills/count-mcp-tools/scripts/count-tools.ts` — reused for data
- `plugins/skills/_shared/endpoint-analysis.ts` — shared endpoint discovery utilities

## Analysis Dimensions

### Coverage

**Endpoint coverage:** What percentage of discovered API endpoints have corresponding tools? Which collections are complete vs. sparse?

**Important:** Exclude ignored endpoints from gap calculations. Endpoints listed in `docs/analysis/IGNORED_ENDPOINTS.md` are deliberately out of scope — they are not missing, they are intentionally skipped. Only count unimplemented endpoints that are *not* in the ignored list as actual gaps.

- 80%+ coverage (excluding ignored): good foundation, focus on quality improvements
- 50-80%: significant gaps, prioritize completing high-value collections
- <50%: early stage, focus on breadth before depth

**CRUD completeness:** For each collection, does it have all the operations users would expect?

| Pattern | What's Missing | Priority |
|---------|---------------|----------|
| Read only (get, list) | Create, update, delete | High if users need to make changes |
| No list/search | Only get-by-id | High — LLM can't discover items without list |
| No delete | Create and update exist | Medium — depends on workflow needs |
| Full CRUD | Nothing | Move to quality and composite tools |

**Read/write balance:** Is the MCP appropriately scoped? An MCP that only reads may need write tools. An MCP with many write tools but no confirmation/preview tools may be dangerous.

### Behavioral Profile

Step back from individual tools and ask: what does this MCP *do*?

**What workflows are supported?** Can a user accomplish their goals end-to-end? For example, if there's a `create-document` tool, is there also a way to find the parent folder, set properties, and publish?

**How do tools compose?** Are there natural sequences that the LLM should follow? Are those sequences documented in tool descriptions (e.g., "After creating, use publish-document to make it live")?

**What cannot be done?** Identify workflows that are partially supported or completely missing. These are either intentional scope boundaries or gaps to fill.

**MCP identity:** In one sentence, what is this MCP for? If you can't say it clearly, the tool descriptions probably don't communicate it either.

### Organization Quality

**Collection scope:** Does each collection have a coherent purpose? A collection with 2 tools and another with 20 suggests the boundaries may need adjustment.

**Mode usefulness:** Do the defined modes map to real user workflows? A mode called "content" that includes 40 tools may be too broad. A mode with 2 tools may not justify its existence.

**Slice distribution:** Are slices used consistently? If some tools have `slices: ["read"]` and similar tools have `slices: []`, filtering won't work reliably.

**Tool count per collection:** Very small collections (1-2 tools) may belong in a parent collection. Very large collections (15+) may need splitting.

## Discussion Frameworks

### "What should I build next?"

Prioritization order:

1. **Complete CRUD gaps** in existing collections (excluding ignored endpoints) — highest value because it completes workflows users already have partial access to
2. **Add list/search tools** where only get-by-id exists — the LLM can't use get-by-id if it doesn't know valid IDs
3. **Add composite tools** for common multi-step patterns revealed by eval traces — reduces turns and cost
4. **New collections** for undiscovered API areas — expands capability breadth
5. **Proxy tools** from chained servers — extends reach without custom code

Within each tier, prioritize by:
- User request frequency (if known)
- Eval scenario coverage (tools used in evals are validated; untested tools may not work)
- API complexity (simpler APIs are faster to implement and less risky)

### "Are my tools well-designed?"

Evaluate tool quality across these dimensions:

**Naming clarity:** Can you tell what a tool does from its name alone? `get-document-by-id` is clear. `fetch-item` is ambiguous.

**Description completeness:** Does the description explain when to use the tool, what it returns, and how it relates to other tools? Good descriptions reduce LLM turns.

**Schema appropriateness:** Are required fields actually required? Are optional fields truly optional? Are parameter descriptions clear?

**Response usefulness:** Does the output contain what the LLM needs for the next step? Too much data wastes tokens. Too little forces additional calls.

**Annotation accuracy:** Do `readOnlyHint`, `destructiveHint`, and `idempotentHint` reflect actual behavior?

### "How do users use this MCP?"

**Eval scenario coverage:** Which workflows are tested by evals? Untested workflows may work but aren't validated.

**Common tool sequences:** From eval traces, what are the most common tool call patterns? These represent validated workflows.

**Unused tools:** Are there tools that no eval scenario exercises? They may be unnecessary, or they may represent untested but important capabilities.

## Differentiation from `/count-mcp-tools`

| Aspect | `/count-mcp-tools` | `/discuss-mcp` behavioral analysis |
|--------|--------------------|------------------------------------|
| Output | Numbers, tables, percentages | Interpretations, recommendations, priorities |
| Question | "How many?" | "So what?" |
| Action | Reports current state | Proposes next steps |
| Data | Runs count-tools script | Runs count-tools script **and** reads tool files, registries, eval traces |
| Mode | Automated reporting | Conversational advisory |

`/count-mcp-tools` provides the facts. This skill provides the meaning.
