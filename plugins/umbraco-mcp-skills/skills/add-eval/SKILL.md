---
name: add-eval
description: Add or update an LLM eval test for a specific tool or collection. Creates a new eval scenario or updates an existing one to cover new tools. Use when adding eval coverage for new or modified tools.
user_invocable: true
---

# Add Eval

Add or update an LLM eval test for a specific tool or collection. This skill creates a new eval scenario or updates an existing one to cover new tools.

Use this skill when:
- You added a new tool with `/add-tool` and want eval coverage
- You modified a tool and need to update the eval scenario
- You want to add a new workflow scenario to an existing collection
- `/build-evals` skipped the collection because eval files already exist

## Prerequisites

Before running, ensure:
1. The collection exists (`src/umbraco-api/tools/{collection}/index.ts`)
2. The project builds: `npm run build`
3. An LLM API key is available (eval tests use Claude Agent SDK — works with a Claude Code subscription or `ANTHROPIC_API_KEY`)

## Arguments

- **Collection name** (required): the collection to add eval coverage for (e.g. `/add-eval form`)
- **Tool or scenario hint** (optional): what to test (e.g. `/add-eval form "copy form workflow"`)

If no hint is provided, compare the tools in the collection against existing eval test coverage and suggest what's missing.

## Agents

| Agent | When to use |
|-------|-------------|
| `eval-test-creator` | Creating or updating eval test files (Step 3 or 4) |

## Critical Rules

**BUILD BEFORE RUNNING.** Eval tests run against `dist/index.js`. Always `npm run build` first.

**RUN COMMANDS SEPARATELY.** Always run build and test as separate Bash calls. Never chain with `&&`.

**ITERATE ON PROMPTS.** Eval tests are probabilistic. If a test fails, the fix is usually in the prompt.

**VERBOSE DURING DEVELOPMENT.** Always set `verbose: true` when creating or debugging.

## Workflow

### Step 0: Check Eval Infrastructure

Check if the eval setup exists:
- `tests/evals/helpers/e2e-setup.ts`
- `tests/evals/jest.config.ts`

If the setup doesn't exist, tell the user to run `/build-evals {collection}` first to create the infrastructure. This skill does not create eval setup files.

### Step 1: Understand Current Coverage

Read the collection's tools and existing eval tests:

- `src/umbraco-api/tools/{collection}/index.ts` — all tools in the collection
- `tests/evals/{collection}-*.test.ts` — existing eval scenarios
- Each eval test file — to understand which tools are covered and in what scenarios

Build an inventory:
- Tools with eval coverage (appear in a scenario's `tools` and `requiredTools` arrays)
- Tools without eval coverage
- Existing workflow scenarios

### Step 2: Decide: Update or Create

Based on the inventory and the user's request:

**Update an existing scenario** when:
- A new tool extends an existing workflow (e.g. adding `copy-form` to a CRUD scenario)
- The new tool is a natural addition to an existing test's prompt

**Create a new scenario** when:
- The new tool represents a different capability (e.g. search, hierarchy, import/export)
- Adding it to an existing scenario would make the prompt too complex
- No existing scenario covers the tool's domain

### Step 3: Update Existing Scenario (if applicable)

If updating an existing eval test:

1. Add the new tool to the `COLLECTION_TOOLS` array
2. Add the tool to `requiredTools` if it must be called
3. Update the prompt to include steps that exercise the new tool
4. Keep the prompt clear and sequential — don't make it overly long

**Build and run:**

```bash
npm run build
```

```bash
npm run test:evals -- --testPathPattern="{collection}"
```

If the test fails, iterate on the prompt. Common fixes:
- Make instructions more explicit
- Add a search/list step to find IDs dynamically
- Simplify the workflow if the prompt is too complex

### Step 4: Create New Scenario (if applicable)

Use the `eval-test-creator` agent to create `tests/evals/{collection}-{workflow}.test.ts`. The agent owns the test template and patterns.

**Build and run:**

```bash
npm run build
```

```bash
npm run test:evals -- --testPathPattern="{collection}-{workflow}"
```

Iterate on the prompt until the test passes reliably.

### Step 5: Report

Report what was done:
- Whether an existing scenario was updated or a new one was created
- File path
- Tools covered
- Test passing status
- Any prompt iterations needed
