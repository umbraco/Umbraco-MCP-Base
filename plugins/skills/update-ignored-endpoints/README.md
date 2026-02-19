# Update Ignored Endpoints Skill

This skill automatically updates the `docs/analysis/IGNORED_ENDPOINTS.md` file by analyzing generated API clients and comparing against implemented MCP tools.

## What It Does

The skill:
1. Auto-discovers all generated API client TypeScript files (excluding Zod schema files)
2. Extracts all API endpoint Result type exports from those files
3. Scans the tools directory to identify which endpoints have MCP tool implementations
4. Categorizes ignored (unimplemented) endpoints by their API group
5. Generates an updated IGNORED_ENDPOINTS.md file with current coverage statistics
6. Preserves existing rationale sections from the documentation

## How It Works

The TypeScript script analyzes:
- **API Endpoints**: Auto-discovered from `src/umbraco-api/api/generated/*.ts` (excluding `*.zod.ts`) by finding all Result type exports (Get, Post, Put, Delete, Create, Update, Search, Patch prefixes)
- **Implemented Tools**: Scanned from `src/umbraco-api/tools/` by finding files with `ToolDefinition` and `withStandardDecorators`, then matching their API client method calls
- **Categorization**: Groups ignored endpoints by common patterns (User, Security, Package, etc.)

## Usage

From the consumer project root, run:

```bash
npx tsx plugins/skills/update-ignored-endpoints/scripts/update-ignored-endpoints.ts
```

Or use the skill through Claude Code:
```
Can you update the ignored endpoints documentation?
```

## Output

The script outputs:
- Updated `docs/analysis/IGNORED_ENDPOINTS.md` file
- Console summary showing:
  - Discovered API client files and their endpoint counts
  - Total unique API endpoints
  - Number of implemented endpoints
  - Number of ignored endpoints
  - API coverage percentage

## Example Output

```
Found 3 API client files:
  - formsApi.ts (142 endpoints)
  - templatesApi.ts (28 endpoints)
  - fieldTypesApi.ts (15 endpoints)
Total: 185 unique API endpoints

✅ IGNORED_ENDPOINTS.md has been updated successfully!

Summary:
  Total API endpoints: 185
  Implemented (unique endpoints): 150
  Ignored: 35
  Coverage: 81.1%
```

## Understanding the Numbers

**Why do tool count and endpoint count differ?**

The difference exists because:
1. Some tools use **multiple API endpoints** (e.g., a publish-with-descendants tool calls 2 endpoints)
2. Some endpoints are **used by multiple tools** (e.g., a delete endpoint called from different contexts)

Both numbers are accurate - they measure different aspects:
- **MCP tools** = Tools exposed to LLMs (counted by `count-mcp-tools`)
- **Unique endpoints** = Unique API endpoints utilized by those tools
- **Coverage** = Percentage of available API endpoints with tool implementations

## Configuration

Customize behavior with environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Root of the consumer project | `.` |
| `TOOLS_DIR` | Path to the tools directory (relative to PROJECT_ROOT) | `src/umbraco-api/tools` |
| `OUTPUT_FILE` | Path for the output markdown file (relative to PROJECT_ROOT) | `docs/analysis/IGNORED_ENDPOINTS.md` |
| `API_GENERATED_DIR` | Path to generated API client files (relative to PROJECT_ROOT) | `src/umbraco-api/api/generated` |

Example:
```bash
PROJECT_ROOT=/path/to/project npx tsx plugins/skills/update-ignored-endpoints/scripts/update-ignored-endpoints.ts
```

## Implementation Details

- Written in TypeScript for type safety and consistency with the project
- Uses the `glob` package for efficient file pattern matching
- Auto-discovers multiple API client files to support projects with multiple Orval configurations
- Preserves the "## Rationale" section from existing documentation
- Endpoints are automatically categorized based on naming patterns
- Uses regex matching to find API endpoints and tool implementations
- Coverage statistics help track progress toward complete API implementation
