---
name: update-ignored-endpoints
description: Update the IGNORED_ENDPOINTS.md documentation file with current endpoint coverage analysis. Discovers all generated API client files and compares against implemented MCP tools. Use when documentation needs to be refreshed or when verifying ignored endpoint status.
allowed-tools: Bash(npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/update-ignored-endpoints/scripts/update-ignored-endpoints.ts*)
---

# Update Ignored Endpoints

This skill updates the IGNORED_ENDPOINTS.md file by analyzing which API endpoints are intentionally not implemented as MCP tools. It auto-discovers all generated API client files to support projects with multiple Orval configurations.

## When to Use

Use this skill when:
- User asks to update the ignored endpoints documentation
- User wants to verify which endpoints are not implemented
- User needs to refresh the endpoint coverage analysis
- Changes have been made to tool implementations and documentation needs updating

## Instructions

1. Run the update script from the consumer project root:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/update-ignored-endpoints/scripts/update-ignored-endpoints.ts
```

2. Review the changes to `docs/analysis/IGNORED_ENDPOINTS.md`

3. The script will:
   - Auto-discover all `*.ts` files in `src/umbraco-api/api/generated/` (excluding `*.zod.ts` and `exampleApi.ts`)
   - Extract all API endpoint names from Result type exports
   - Compare against implemented MCP tools (files with `ToolDefinition` + `withStandardDecorators`)
   - Categorize ignored endpoints using collection names from `.discover.json` (falls back to "Uncategorized" if no manifest exists)
   - Update the documentation with current ignored endpoints
   - Preserve the rationale sections
   - Update the total count and coverage percentage

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Root of the consumer project | `.` |
| `TOOLS_DIR` | Path to the tools directory (relative to PROJECT_ROOT) | `src/umbraco-api/tools` |
| `OUTPUT_FILE` | Path for the output markdown file (relative to PROJECT_ROOT) | `docs/analysis/IGNORED_ENDPOINTS.md` |
| `API_GENERATED_DIR` | Path to generated API client files (relative to PROJECT_ROOT) | `src/umbraco-api/api/generated` |

## Supporting Files

The update script is at [scripts/update-ignored-endpoints.ts](scripts/update-ignored-endpoints.ts) and analyzes all generated API client files and existing MCP tools to generate updated documentation.
