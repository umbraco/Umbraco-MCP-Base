---
name: discuss-mcp
description: Advisory skill for reflecting on and improving an MCP server — trace analysis, chained tool design, and behavioral coverage review.
user_invocable: true
allowed-tools: Bash(npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discuss-mcp/scripts/analyze-traces.ts*), Bash(COLLECTION=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discuss-mcp/scripts/analyze-traces.ts*), Bash(LOG_FILE=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/discuss-mcp/scripts/analyze-traces.ts*), Bash(npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts*), Bash(SHOW_TOOLS=true npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts*)
---

# Discuss MCP

Advisory skill for reflecting on and improving an MCP server. Unlike builder skills (`/build-tools`, `/build-evals`) that execute generation workflows, this skill is **conversational** — it helps developers understand what to improve, why, and how.

## When to Use

Use this skill when the developer asks:
- "How can I improve my MCP server?"
- "Why are my evals slow/expensive/failing?"
- "Should I add composite tools or proxy tools?"
- "What tools am I missing?"
- "What should I build next?"
- "Are my tools well-designed?"
- "How do I reduce eval cost/turns?"

## Improvement Paths

Route to the appropriate sub-file based on what the developer wants to discuss:

### 1. Trace Optimization — "My evals are slow/expensive/failing"

The developer wants to analyze eval performance and iteratively improve tools based on trace data.

**Read**: [trace-optimization.md](trace-optimization.md)

**Signals**: mentions evals, traces, cost, turns, tokens, performance, "why does the LLM struggle", repeated tool calls, wrong tool selection.

### 2. Chained Tool Design — "Should I add composite/proxy tools?"

The developer wants to discuss adding tools that delegate to other MCP servers — whether to proxy or create composites.

**Read**: [chained-tools.md](chained-tools.md)

**Signals**: mentions chaining, proxy, composite, multi-server, delegation, orchestration, combining data from multiple sources.

### 3. Behavioral Analysis — "What should I build next?"

The developer wants a holistic review of their MCP: coverage gaps, organizational quality, prioritization of next steps.

**Read**: [behavioral-analysis.md](behavioral-analysis.md)

**Signals**: mentions coverage, gaps, what's missing, next steps, priorities, tool organization, modes, slices, "are my tools well-designed".

## Conversational Guidelines

When advising on MCP improvements, follow these principles:

1. **Ask before recommending.** Understand the developer's goals before suggesting changes. "What workflows are you trying to support?" is more useful than jumping to solutions.

2. **Propose with trade-offs, not prescriptions.** Present options with pros and cons. "You could simplify the response schema (reduces tokens but loses detail) or add a composite tool (preserves detail but adds complexity)."

3. **Use their own codebase as evidence.** Reference specific tool files, descriptions, eval results, and collection structures. Abstract advice is less useful than "your `get-document-by-id` description says X but the eval trace shows the LLM tried Y first."

4. **Enter plan mode for concrete changes.** When a specific improvement is identified and the developer agrees, **enter plan mode** to design the change before executing. This ensures the developer approves the approach.

5. **Summarize action items.** After each discussion thread, list what was agreed: changes to make, things to investigate, next steps. Keep it concrete.

6. **Iterate, don't overhaul.** Prefer small, measurable improvements over large rewrites. One description fix that drops turns from 5 to 3 is more valuable than a speculative restructuring.

## Multiple Topics

If the developer's question spans multiple paths (e.g., "my evals are slow and I think I need composite tools"), read both sub-files and synthesize. Start with the most pressing concern — usually trace optimization reveals whether chaining is actually needed.
