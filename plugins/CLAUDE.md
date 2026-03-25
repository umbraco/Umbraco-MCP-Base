# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the MCP skills plugin.

## Plugin Overview

Claude Code plugin providing skills and agents for building Umbraco MCP servers using `@umbraco-cms/mcp-server-sdk`. Not published to npm (distributed via Claude Code marketplace).

## Commands

```bash
npm run test           # Run eval tests
npm run test:verbose   # Run with verbose output (E2E_VERBOSITY=verbose)
```

## Structure

```
plugins/
├── skills/
│   ├── mcp-patterns/
│   │   └── SKILL.md       # MCP development patterns reference
│   ├── mcp-testing/
│   │   └── SKILL.md       # Testing patterns reference
│   ├── build-tools/
│   │   └── SKILL.md       # Tool collection generator
│   ├── build-tools-tests/
│   │   └── SKILL.md       # Integration test generator
│   ├── build-evals/
│   │   └── SKILL.md       # Eval test generator
│   └── discuss-mcp/
│       ├── SKILL.md       # MCP improvement advisor
│       ├── trace-optimization.md
│       ├── chained-tools.md
│       ├── behavioral-analysis.md
│       └── scripts/
│           └── analyze-traces.ts
├── agents/
│   ├── mcp-tool-creator.md
│   ├── mcp-tool-description-writer.md
│   ├── test-builder-helper-creator.md
│   ├── integration-test-creator.md
│   ├── integration-test-validator.md
│   ├── eval-test-creator.md
│   └── mcp-tool-reviewer.md

└── __evals__/
    ├── setup.ts           # Test helpers (runSkillTest, runAgentContentTest)
    └── *.eval.ts          # Eval tests for skills/agents
```

## Skills

Knowledge skills loaded via slash commands:

| Skill | Command | Purpose |
|-------|---------|---------|
| mcp-patterns | `/mcp-patterns` | MCP development patterns, helper usage, project structure |
| mcp-testing | `/mcp-testing` | Eval test patterns (LLM-driven acceptance tests) |
| build-tools | `/build-tools` | Generate tool collections from `.discover.json` |
| build-tools-tests | `/build-tools-tests` | Generate integration tests for tool collections |
| build-evals | `/build-evals` | Generate LLM eval tests for tool collections |
| discuss-mcp | `/discuss-mcp` | Advisory skill for improving MCP tools (traces, chaining, coverage) |

## Agents

Automatically invoked agents for specific tasks:

| Agent | Purpose |
|-------|---------|
| mcp-tool-creator | Creates tools following toolkit patterns |
| mcp-tool-description-writer | Writes effective tool descriptions |
| test-builder-helper-creator | Creates test builders and helpers |
| integration-test-creator | Creates unit/integration tests |
| integration-test-validator | Validates test quality |
| eval-test-creator | Creates LLM-based acceptance tests |
| mcp-tool-reviewer | Reviews tools for LLM-readiness (schema, descriptions, responses) |

## Eval Testing

Tests verify skills and agents produce correct output:

- Uses Claude Agent SDK to run skills/agents
- Checks output contains expected patterns
- Skills need 5-6 turns (discover, read, respond)
- Tests run with `--runInBand` and 120s timeout

**Key test helpers:**
- `runSkillTest(prompt, skillPath, options)` - Test a skill
- `runAgentContentTest(prompt, agentContent, options)` - Test agent directly
- `verifyOutputContainsAny(output, patterns)` - Check for expected content
- `loadPluginContent(path)` - Load agent/skill content

## Installation

Users install via Claude Code:
```bash
/plugin marketplace add umbraco/Umbraco-MCP-Base
/plugin install umbraco-mcp-skills@umbraco/Umbraco-MCP-Base
```

## Writing Skills

Skills are markdown files in `skills/{name}/SKILL.md`:
- Provide reference information Claude can use
- Include patterns, examples, and best practices
- Loaded when user invokes `/{skill-name}`

## Writing Agents

Agents are markdown files in `agents/{name}.md`:
- Define specialized behaviors for specific tasks
- Automatically invoked when task matches agent purpose
- Should include step-by-step instructions and patterns
