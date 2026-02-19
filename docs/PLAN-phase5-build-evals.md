# Plan: Phase 5 — Build Evals Skill

## Context

Phase 4 (`/build-tools` + `/build-tools-tests`) creates MCP tools and integration tests. Phase 5 adds eval tests — LLM-driven acceptance tests that verify tools work correctly when used by an AI agent. The `eval-test-creator` agent and `/mcp-testing` skill already define patterns. What's missing is an orchestration skill that reads `.discover.json` and drives eval test creation per collection.

**Key difference from integration tests:**
- Integration tests: one file per tool, test handlers directly against real API, deterministic
- Eval tests: group related tools by workflow, test via Claude Agent SDK, probabilistic, require `npm run build` first (run against `dist/`)

## What's needed

### New skill: `/build-evals` (user-invocable)

Location: `plugins/skills/build-evals/SKILL.md`

**Input:** `.discover.json` + existing tool files from `/build-tools`

**Workflow per collection:**

1. **Check prerequisites**
   - `.discover.json` exists
   - Tool collection exists (`src/umbraco-api/tools/{collection}/index.ts`)
   - Project builds (`npm run build`)
   - Skip if `__evals__/setup.ts` already exists for this collection

2. **Read tool files** to understand available operations per collection
   - Which tools exist (get, list, create, update, delete, search, etc.)
   - Their names, input schemas, descriptions

3. **Create eval setup** at `src/umbraco-api/tools/{collection}/__evals__/setup.ts`
   - Configure eval framework with `configureEvals()`
   - Detect API mode: check if `src/mocks/` exists with handlers → `USE_MOCK_API: "true"`, otherwise real API using `.env` credentials
   - Set conservative defaults: Haiku model, 10 turns, $0.25 budget, 60s timeout

4. **Design eval scenarios** based on available tools
   - **CRUD lifecycle** (if create + list/get + update + delete exist): create → list → get → update → delete
   - **Read-only workflow** (if only get/list/search): list → get, or search → get
   - **Hierarchical workflow** (if folder/tree tools exist): create folder → create item in folder → navigate
   - Group related tools into 1-2 workflow scenarios per collection

5. **Create eval test files** using `eval-test-creator` agent
   - One file per workflow scenario: `{collection}-{workflow}.eval.ts`
   - Step-by-step prompts with numbered instructions
   - Unique identifiers (timestamps) for test data
   - Success pattern at the end
   - `verbose: true` during development

6. **Build and run**
   - `npm run build` (required — evals test against `dist/`)
   - `npm run test:evals -- __evals__/{collection}`
   - If tests fail, analyze verbose output and iterate on prompts

7. **Next collection** — repeat steps 1-6

8. **Final verification** — `npm run build && npm run test:evals`

### Agent orchestration

| Agent | When to use |
|-------|-------------|
| `eval-test-creator` | Creating eval test files (Step 5) |

### Arguments

- No arguments: build evals for all collections from `.discover.json`
- Single collection name: build evals only for that collection (e.g. `/build-evals form`)

### Critical rules

- **BUILD BEFORE RUNNING.** Eval tests run against `dist/index.js`. Always `npm run build` first.
- **ONE COLLECTION AT A TIME.** Complete each collection before starting the next.
- **GROUP TOOLS BY WORKFLOW.** Unlike integration tests (one file per tool), eval tests group related tools into workflow scenarios.
- **ITERATE ON PROMPTS.** Eval tests are probabilistic. If a test fails, the fix is usually in the prompt — make instructions more explicit, add search steps for IDs, use unique identifiers.
- **VERBOSE DURING DEVELOPMENT.** Always set `verbose: true` when creating/debugging. Disable after tests pass reliably.

## Files to create/modify

### `plugins/skills/build-evals/SKILL.md` (NEW)
The skill instructions covering the full per-collection eval workflow.

### `plugins/CLAUDE.md` (UPDATE)
Add `build-evals` to skills table.

### `docs/MCP-DEVELOPMENT-LOOP.md` (UPDATE)
Phase 5.1 should reference `/build-evals` skill.

## Not changing

- **`eval-test-creator` agent** — already complete, referenced by the skill
- **`/mcp-testing` skill** — knowledge reference, not modified
- **SDK eval framework** — no new features needed
- **Template eval examples** — source of patterns, not modified

## Verification

1. Use existing test project with tools already built
2. Run `/build-evals` against a collection
3. Verify: `__evals__/setup.ts` created, eval test files created
4. `npm run build && npm run test:evals` passes
