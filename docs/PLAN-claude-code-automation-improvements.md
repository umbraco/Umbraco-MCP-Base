# Plan: Claude Code Automation Improvements

## Context

After analyzing the monorepo's Claude Code setup — 7 agents, 8 skills, permissions config — there are gaps in automated guardrails and developer tooling. No hooks exist for catching type errors or protecting secrets. No MCP servers provide live documentation for the many npm dependencies. Some useful skill/agent patterns are missing.

These are independent improvements that can be implemented in any order.

---

## 1. Hook: TypeScript compile check on edit

**Why:** Strict TypeScript across all workspaces but no automated check. Type errors accumulate until the next manual `npm run compile`.

**File:** `.claude/settings.json` — add `hooks` section

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "bash -c 'FILE=$(echo \"$TOOL_INPUT\" | grep -o '\"file_path\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4); if [[ \"$FILE\" == *.ts ]]; then npm run compile 2>&1 | tail -5; fi'"
      }
    ]
  }
}
```

**Verify:** Edit a `.ts` file with a type error — hook should surface the compile error.

---

## 2. Hook: Block `.env` and `settings.local.json` edits

**Why:** Both are gitignored and contain secrets (Umbraco credentials, API keys). Prevents accidental modification.

**File:** `.claude/settings.json` — add to `hooks.PreToolUse`

```json
{
  "matcher": "Edit|Write",
  "command": "bash -c 'FILE=$(echo \"$TOOL_INPUT\" | grep -o '\"file_path\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4); if echo \"$FILE\" | grep -qE \"\\.env$|settings\\.local\\.json$\"; then echo \"BLOCKED: Cannot edit secrets file: $FILE\" >&2; exit 1; fi'"
}
```

**Verify:** Try to edit `.env` — should be blocked. Editing `.env.example` should still work.

---

## 3. MCP Server: context7 for live documentation

**Why:** The project depends on `@modelcontextprotocol/sdk`, `zod`, `axios`, `msw`, `orval`, `tsup`, `jest` — all libraries where API details change across versions. context7 provides live docs lookup instead of relying on training data.

**Install:** `claude mcp add context7 -- npx -y @upstash/context7-mcp@latest`

**Verify:** Ask Claude about a specific zod v4 API or msw v2 handler pattern and check it uses live docs.

---

## 4. Skill: `/review-tool` — User-invocable tool quality reviewer

**Why:** The `mcp-tool-reviewer` agent exists but is only auto-invoked by Claude. A user-invocable skill wrapping it lets developers run `/review-tool form` to get an on-demand quality report for a collection's tools.

**File:** `plugins/skills/review-tool/SKILL.md`

```yaml
---
name: review-tool
description: Review MCP tools for LLM-readiness — descriptions, schemas, annotations, response quality. Accepts a collection name as argument.
user_invocable: true
---
```

**Content:**
- Accept collection name as argument (or review all if none given)
- Read tool files in the collection directory
- Invoke the `mcp-tool-reviewer` agent content against each tool
- Summarize findings: description quality, schema issues, annotation accuracy, response size concerns
- Reference `plugins/agents/mcp-tool-reviewer.md` for the review criteria

**Verify:** Run `/review-tool example` on the template project's example collection.

---

## 5. Skill: `/scaffold-collection` — New collection bootstrapper

**Why:** `/build-tools` generates tools from `.discover.json`, but there's no quick way to scaffold the boilerplate for a new collection (index.ts, directory structure, `__tests__/` folder, mode registry entry, slice assignments).

**File:** `plugins/skills/scaffold-collection/SKILL.md`

```yaml
---
name: scaffold-collection
description: Scaffold a new empty tool collection with index.ts, directory structure, and registry entries. Accepts collection name as argument.
user_invocable: true
---
```

**Content:**
- Accept collection name as argument
- Create directory structure: `src/umbraco-api/tools/{name}/`, `__tests__/`
- Generate `index.ts` with `ToolCollectionExport` boilerplate
- Add collection to mode registry if a default mode exists
- Reference `/mcp-patterns` for the correct collection structure
- Remind developer to run `/build-tools {name}` next to generate actual tools

**Verify:** Run `/scaffold-collection test-collection`, verify directory and index.ts are created.

---

## 6. Agent: `sdk-api-reviewer` — Public API surface checker

**Why:** The SDK has 6 entry points consumed by template, plugins, and external projects. Changes to exports can break consumers silently.

**File:** `plugins/agents/sdk-api-reviewer.md`

**Content:**
- Triggered when files in `packages/mcp-server-sdk/src/` are modified
- Checks whether public exports changed (new, removed, or signature changes)
- Cross-references against `tsup.config.ts` entry points and `package.json` exports map
- Reports breaking changes vs additive changes
- Read-only agent (like `mcp-tool-reviewer` and `integration-test-validator`)

**Verify:** Rename an exported function in the SDK, run the agent, confirm it flags the breaking change.

---

## 7. Agent: `eval-regression-checker` — Before/after eval comparison

**Why:** After tool changes, developers need to verify evals didn't regress. This automates Step 7 of the self-improvement loop in `/discuss-mcp`.

**File:** `plugins/agents/eval-regression-checker.md`

**Content:**
- Accepts before/after eval log files or runs evals and compares to a baseline
- Parses `logTestResult()` output (reuses patterns from `analyze-traces.ts`)
- Compares per-scenario: turns, cost, tokens, success
- Flags regressions (increased turns, new failures, cost spikes)
- Reports improvements (decreased turns, cost savings)

**Verify:** Make a tool description change, run evals before and after, pass both logs to the agent.

---

## Implementation Order (suggested)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | context7 MCP server | 1 command | Immediate — better library answers |
| 2 | Block secrets hook | Small | Prevents accidental secret exposure |
| 3 | TypeScript compile hook | Small | Catches type errors early |
| 4 | `/review-tool` skill | Medium | On-demand tool quality checks |
| 5 | `/scaffold-collection` skill | Medium | Faster collection setup |
| 6 | `sdk-api-reviewer` agent | Medium | Catches SDK breaking changes |
| 7 | `eval-regression-checker` agent | Medium | Automated eval comparison |
