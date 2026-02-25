---
name: count-mcp-tools
description: Count MCP tools in an SDK-based project and analyze implementation gaps against .discover.json. Use when the user asks about tool counts, progress, or collection coverage.
allowed-tools: Bash(npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts*), Bash(SHOW_TOOLS=true npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts*), Bash(OUTPUT_FILE=* npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts*)
---

# Count MCP Tools

This skill counts all MCP tools in the project and provides a detailed breakdown by collection. When a `.discover.json` manifest exists, it also performs gap analysis showing which collections have tools, integration tests, and eval tests.

## When to Use

Use this skill when:
- User asks "how many tools do we have?"
- User wants statistics about tool collections
- User needs to know tool distribution across collections
- User asks about project progress or coverage
- User wants to evaluate skill/agent completion status
- User asks which collections still need tests or evals

## Instructions

1. Run the counting script from the consumer project root:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts
```

To also show all tool names in the console output:

```bash
SHOW_TOOLS=true npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts
```

To save results to a markdown file:

```bash
OUTPUT_FILE=docs/analysis/api-endpoints-analysis.md npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/count-mcp-tools/scripts/count-tools.ts
```

2. Present results showing:
   - Total tool count
   - Breakdown by collection (sorted alphabetically)
   - List of individual tool names per collection (when SHOW_TOOLS=true or in markdown output)
   - Gap analysis table (when .discover.json exists)
   - If OUTPUT_FILE is set, saves to markdown file with full tool listing

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TOOLS_DIR` | Path to the tools directory (relative to PROJECT_ROOT) | `src/umbraco-api/tools` |
| `OUTPUT_FILE` | Optional path to save markdown analysis report | _(none)_ |
| `SHOW_TOOLS` | Set to `true` to show individual tool names in console output | `false` |
| `PROJECT_ROOT` | Root of the consumer project | `.` |
| `EVALS_DIR` | Path to eval tests directory (relative to PROJECT_ROOT) | `tests/evals` |
| `API_GENERATED_DIR` | Path to generated API client files (relative to PROJECT_ROOT) | `src/umbraco-api/api/generated` |

## Gap Analysis

When a `.discover.json` file exists in the project root, the script automatically compares expected collections against actual implementation:

```
Gap Analysis (.discover.json):
================================================================================
Collection           | Tools | Endpoints | Tests | Evals | Status
--------------------------------------------------------------------------------
form                 |    12 |     12/20 |   yes |   yes | Complete
form-template        |     6 |      6/8  |   yes |    no | Missing evals
field-type           |     0 |      0/5  |    no |    no | Not started
folder               |     4 |      4/4  |   yes |   yes | Complete
================================================================================
2/4 collections complete | 22/37 endpoints covered (59%)
```

For each collection listed in `.discover.json`, it checks:
- **Tools**: Does the collection directory exist with tool files? (count > 0)
- **Tests**: Are there integration test files in `{TOOLS_DIR}/{collection}/__tests__/*.test.ts`?
- **Evals**: Are there eval test files matching `{EVALS_DIR}/*{collection}*.test.ts`?

## Supporting Files

The counting script is at [scripts/count-tools.ts](scripts/count-tools.ts) and counts TypeScript files that define actual MCP tools (containing `ToolDefinition` and `withStandardDecorators`), excluding `index.ts`, test files, and helper/utility files.
