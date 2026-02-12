# MCP Server Development Loop

This document describes the complete development workflow for building Umbraco MCP servers using the `@umbraco-cms/mcp-server-sdk`.

## Overview

The development loop consists of five phases:

1. **Create** - Scaffold the project
2. **Init** - Configure instance, trim features
3. **Discovery & Planning** - API client, groups, modes, slices, permissions
4. **Tool Implementation** - Build tools, tests, optimizations
5. **Evaluation & Iteration** - Eval tests, chaining, refinement

Each phase builds on the previous. The goal is to create a lean, well-tested MCP server that exposes Umbraco APIs effectively to AI assistants.

---

## Phase 1: Create

### Step 1.1: Scaffold the Project

Use the scaffolding CLI to create a new MCP server project:

```bash
npx create-umbraco-mcp-server my-mcp-server
cd my-mcp-server
npm install
```

This creates a project with:
- MCP server boilerplate
- Orval configuration for API client generation
- Example tools and tests
- Optional features (mocks, chaining, evals)

---

## Phase 2: Init

### Step 2.1: Configure the Project

Run the init command to configure the project and optionally create an Umbraco instance:

```bash
npx create-umbraco-mcp-server init
```

This wizard helps you:
- Create a new Umbraco instance (built in background via PSW) or connect to an existing one
- Remove unused features (mocks, chaining, examples, evals)

**Principle: Start lean.** Remove features you don't need now. They can be regenerated later via "add" skills when actually needed.

---

## Phase 3: Discovery & Planning

### Step 3.1: Connect to the Umbraco Instance

If you created an instance in Phase 2, wait for it to finish building, then start it:

```bash
npm run start:umbraco
```

### Step 3.2: Run Discover

With the Umbraco instance running, use the `discover` command to automate API discovery, client generation, and planning:

```bash
npx create-umbraco-mcp-server discover
```

This interactive command will:
1. Prompt for the Umbraco base URL (auto-detects from `launchSettings.json`, `.env`, or `orval.config.ts`)
2. Health-check the instance and update `.env` with the base URL
3. Discover available Swagger endpoints
4. Let you select which API to target
5. Update `orval.config.ts` and generate the API client
6. Analyze the OpenAPI spec to extract groups, operations, slices, and permissions
7. Print a discovery report
8. Let you multi-select which groups to include as tool collections
9. Ask Claude to suggest meaningful mode groupings from selected collections
10. Optionally update `mode-registry.ts` and `slice-registry.ts`
11. Write `.discover.json` manifest for use by `/build-tools` in Phase 4

### Step 3.3: Review and Refine

After discovery, review the generated registries and refine as needed:

- **Modes**: Combine or split groups based on your use cases (e.g., `commerce-admin` vs `commerce-catalog`)
- **Slices**: Add domain-specific slices beyond the standard CRUD operations
- **Permissions**: Note the required OAuth2 scopes for your `.env` configuration

---

## Phase 4: Tool Implementation

### Step 4.1: Build Tools

Use the `/build-tools` skill to generate tools for selected collections from `.discover.json`:

```bash
/build-tools           # Build all collections
/build-tools form      # Build a single collection
```

For each collection, the skill will:
1. Read the swagger spec for operations matching the collection's tag
2. Map operations to Orval-generated client functions and Zod schemas
3. Create tool files (one per operation) with correct slices, annotations, and descriptions
4. Create the collection `index.ts` and register it in `src/umbraco-api/tools/index.ts`
5. Compile to verify types (`npm run compile`)

Collections that already have `src/umbraco-api/tools/{name}/index.ts` are skipped.

### Step 4.1b: Build Tests

Use the `/build-tools-tests` skill to generate integration tests for tool collections:

```bash
/build-tools-tests           # Build tests for all collections
/build-tools-tests form      # Build tests for a single collection
```

For each collection, the skill will:
1. Read existing tool files to understand schemas and handlers
2. Create test setup (`__tests__/setup.ts`) with API client configuration
3. Create test builders and helpers (`__tests__/helpers/`)
4. Create integration test files (2-3 tests per tool, run sequentially against real API)
5. Validate tests against quality checklist

Collections that already have `__tests__/setup.ts` are skipped.

### Step 4.2: Review Tools for LLM-Readiness

After tools are built, the `mcp-tool-reviewer` agent checks each tool against an LLM-readiness checklist:

- **Schema simplification** — max 3-5 fields, no nested objects, no UUID generation from LLM
- **Description quality** — action verbs, constraints, when NOT to use
- **Response shaping** — essential fields only, actionable errors
- **Composite tool opportunities** — sequences that should be bundled
- **Naming & annotations** — consistent, correct hints per HTTP method
- **Context & scope** — no redundant tools, reasonable count per collection
- **Pagination design** — appropriate page sizes, documented mechanics

Address any issues flagged by the reviewer before moving to Phase 5.

### Step 4.3: Define Constants and Environment Variables

Set up configuration for well-known IDs and API credentials:

```typescript
// src/constants/constants.ts
export const WELL_KNOWN_IDS = {
  ROOT_PRODUCT_FOLDER: '...',
  DEFAULT_STORE: '...',
};

// .env
UMBRACO_BASE_URL=https://localhost:44331
UMBRACO_CLIENT_ID=...
UMBRACO_CLIENT_SECRET=...
```

---

## Phase 5: Evaluation & Iteration

### Step 5.1: Create Eval Tests

Use the `/build-evals` skill to generate eval tests for tool collections:

```bash
/build-evals           # Build evals for all collections
/build-evals form      # Build evals for a single collection
```

For each collection, the skill will:
1. Read existing tool files to understand available operations
2. Create eval setup (`tests/evals/helpers/e2e-setup.ts`) with API mode detection (mock vs real)
3. Design workflow scenarios (CRUD lifecycle, read-only, search, hierarchy)
4. Create eval test files grouping related tools by workflow
5. Build and run: `npm run build && npm run test:evals`
6. Iterate on prompts if tests fail

Collections that already have eval test files in `tests/evals/` are skipped.

**Key difference from integration tests:** Eval tests group related tools into workflow scenarios (1-2 files per collection) rather than testing each tool individually.

### Step 5.2: Evaluate Chaining Value

Determine if chaining to other MCP servers (e.g., `@umbraco-cms/mcp-dev`) adds value:

| Scenario | Chain? | Reason |
|----------|--------|--------|
| Need content + commerce data | Yes | Combine content and commerce tools |
| Commerce-only operations | No | Standalone is simpler |
| Complex workflows | Yes | Leverage existing tools |

If chaining adds value, configure in `src/config/mcp-servers.ts`.

### Step 5.3: Iterate with Eval Feedback

Run eval tests and analyze traces:

```bash
npm run test:evals
```

Common issues revealed by evals:

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Wrong tool selected | Poor tool description | Improve description clarity |
| Missing parameters | Unclear parameter docs | Add examples to descriptions |
| Tool not found | Name not intuitive | Rename tool |
| Inefficient tool chain | Missing composite tool | Create workflow tool |

**Use eval traces** to understand how the LLM interprets your tools and iterate on descriptions, parameters, and tool design.

---

## Summary Checklist

### Phase 1: Create
- [ ] Scaffolded project with `create-umbraco-mcp-server`

### Phase 2: Init
- [ ] Ran `init` to configure project and create Umbraco instance
- [ ] Removed unused features

### Phase 3: Discovery & Planning
- [ ] Umbraco instance running with package installed
- [ ] Ran `create-umbraco-mcp-server discover` to analyze APIs
- [ ] API client generated with Orval
- [ ] Discovery report reviewed (groups, operations, slices, permissions)
- [ ] Mode and slice registries updated
- [ ] Modes refined for target use cases

### Phase 4: Implementation
- [ ] Tools built with `/build-tools` skill
- [ ] Integration tests written and passing
- [ ] Tools reviewed by `mcp-tool-reviewer` (LLM-readiness checklist)
- [ ] Review issues addressed
- [ ] Constants and env vars configured

### Phase 5: Evaluation
- [ ] Eval tests created with `/build-evals` skill
- [ ] Chaining value assessed
- [ ] Iterated based on eval feedback
- [ ] Tool descriptions refined

---

## Related Skills and Agents

| Resource | Phase | Purpose |
|----------|-------|---------|
| `create-umbraco-mcp-server init` | 2 | Project setup and configuration |
| `create-umbraco-mcp-server discover` | 3 | API discovery, client generation, and planning |
| `/build-tools` skill | 4 | Orchestrates tool generation per collection |
| `/build-tools-tests` skill | 4 | Orchestrates integration test generation per collection |
| `/mcp-patterns` | 4 | Tool implementation patterns reference |
| `/build-evals` skill | 5 | Orchestrates eval test generation per collection |
| `/mcp-testing` | 4-5 | Testing patterns reference (unit + eval) |
| `mcp-tool-creator` agent | 4 | Creates tools following patterns |
| `mcp-tool-reviewer` agent | 4 | Reviews tools for LLM-readiness |
| `integration-test-creator` agent | 4 | Creates integration tests |
| `integration-test-validator` agent | 4 | Validates test quality |
| `eval-test-creator` agent | 5 | Creates eval tests |

---

## Principles

1. **Start lean** - Remove what you don't need; regenerate later when needed
2. **Regenerate, don't restore** - Use skills to add features from current docs, not stale backups
3. **Eval-driven improvement** - Let eval tests guide tool refinement
4. **Document optimizations** - Capture API workarounds as reusable patterns
5. **Group related tools** - In modes, slices, and eval tests
