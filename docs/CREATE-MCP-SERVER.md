# Create Umbraco MCP Server

A CLI toolkit and Claude Code plugin for building MCP servers that expose Umbraco APIs to AI assistants. The workflow spans five phases — from scaffolding a project to evaluating tool effectiveness with LLMs.

## Prerequisites

- **Node.js 22+**
- **.NET SDK 9+** (for creating Umbraco instances in Phase 2)
- **SQL Server** (for Umbraco instance database in Phase 2)
- **Claude Code** (for Phases 4-5: tool building and evaluation)

---

## Phase 1: Create

Scaffold a new MCP server project.

```bash
npx create-umbraco-mcp-server my-mcp-server
```

This creates a ready-to-go project structure:

- MCP server boilerplate with `@umbraco-cms/mcp-server-sdk`
- Orval configuration for API client generation
- Example tool collection and tests
- Optional features: mocks (MSW), MCP chaining, evals

**Output:**

```
cd my-mcp-server
npm install
npx create-umbraco-mcp-server init
```

---

## Phase 2: Init

Configure the project and optionally create an Umbraco instance.

```bash
npx create-umbraco-mcp-server init
```

### Umbraco Instance Setup

The init wizard offers three paths:

| Option | What happens |
|--------|-------------|
| **Create new instance** | Detects/installs [PSW CLI](https://www.nuget.org/packages/PackageScriptWriter.Cli), prompts for SQL Server connection string and NuGet package (searched from Umbraco Marketplace), builds the instance in `demo-site/`, populates `.env` with base URL and client credentials |
| **Use existing instance** | Prompts for Swagger JSON URL, updates `orval.config.ts` |
| **Skip for now** | Configure the API connection later |

### Feature Configuration

For each detected feature, you choose to keep or remove:

| Feature | Default | Description |
|---------|---------|-------------|
| Mock infrastructure (MSW) | Keep | Mocks for testing without a real Umbraco instance |
| MCP chaining | Keep | Proxy tools from other MCP servers like `@umbraco-cms/mcp-dev` |
| Example tools | Remove | Example tool collections demonstrating patterns |
| LLM eval tests | Keep | Claude-based acceptance tests for tool effectiveness |

**Principle: Start lean** — remove what you don't need. Features can be regenerated later.

**Output (with instance created):**

```
1. Start the Umbraco instance: npm run start:umbraco
2. (in a separate terminal) npx create-umbraco-mcp-server discover
```

---

## Phase 3: Discover

Analyze a running Umbraco instance's APIs and plan tool collections.

```bash
npx create-umbraco-mcp-server discover
```

**Prerequisite:** The Umbraco instance must be running.

### What it does

1. **Detect base URL** from `launchSettings.json`, `.env`, or `orval.config.ts`
2. **Health check** the instance
3. **Check/create API user** for authentication
4. **Discover Swagger endpoints** exposed by the instance
5. **Select which API** to target
6. **Update orval config** and **generate API client**
7. **Analyze the OpenAPI spec** — extract groups, operations, slices (CRUD categories), and permissions
8. **Print discovery report** — groups, operation counts, slices, security scheme
9. **Select groups** to include as tool collections
10. **Suggest modes** — asks Claude to propose meaningful mode groupings (falls back to heuristic)
11. **Update registries** — optionally write to `mode-registry.ts` and `slice-registry.ts`
12. **Write `.discover.json`** — manifest consumed by `/build-tools` in Phase 4

**Output:**

```
Next steps:
  1. Open the project in Claude Code
  2. Install the Umbraco MCP skills plugin in Claude Code:
       /plugin marketplace add umbraco/umbraco-mcp-server-sdk
       /plugin install umbraco-mcp-skills@umbraco-mcp-server-sdk-plugins
  3. Run /build-tools to generate tool collections from .discover.json
  4. Run /build-tools-tests to generate integration tests for the collections
```

---

## Phase 4: Tool Implementation

Build tool collections using Claude Code skills. Install the plugin first:

```
/plugin marketplace add umbraco/umbraco-mcp-server-sdk
/plugin install umbraco-mcp-skills@umbraco-mcp-server-sdk-plugins
```

### Build Tools

```
/build-tools              # Build all collections from .discover.json
/build-tools form         # Build a single collection
```

For each collection, the skill reads the swagger spec, maps operations to Orval-generated client functions and Zod schemas, creates tool files with correct slices and annotations, registers the collection, and compiles to verify types. Collections that already exist are skipped.

### Build Tests

```
/build-tools-tests        # Generate tests for all collections
/build-tools-tests form   # Generate tests for a single collection
```

Generates integration tests per collection with test setup, builders/helpers, and 2-3 tests per tool. Validates tests against a quality checklist.

### Tool Review

After tools are built, the `mcp-tool-reviewer` agent checks each tool for LLM-readiness:

- Schema simplification (max 3-5 fields, no nested objects)
- Description quality (action verbs, constraints, when NOT to use)
- Response shaping (essential fields only, actionable errors)
- Composite tool opportunities
- Naming and annotation consistency
- Pagination design

### Reference

```
/mcp-patterns             # Tool implementation patterns reference
/mcp-testing              # Testing patterns reference
/count-mcp-tools          # Count tools per collection
```

---

## Phase 5: Evaluation & Iteration

Test tool effectiveness using LLM-driven eval tests.

### Build Evals

```
/build-evals              # Generate eval tests for all collections
/build-evals form         # Generate eval tests for a single collection
```

Designs workflow scenarios (CRUD lifecycle, read-only, search, hierarchy) and creates eval test files grouping related tools by workflow. Key difference from integration tests: eval tests verify that an LLM can use the tools effectively, not just that the tools work.

### Run and Iterate

```bash
npm run build && npm run test:evals
```

Use `/discuss-mcp` for advisory analysis:

- **Trace optimization** — analyze eval traces to find inefficiencies
- **Chaining analysis** — identify tools that could benefit from MCP chaining
- **Coverage analysis** — find API operations not yet exposed as tools

The eval-driven iteration loop: run evals, analyze traces, improve tools, repeat.

---

## Skills Reference

| Skill | Command | Phase | Purpose |
|-------|---------|-------|---------|
| build-tools | `/build-tools` | 4 | Generate tool collections from `.discover.json` |
| build-tools-tests | `/build-tools-tests` | 4 | Generate integration tests per collection |
| build-evals | `/build-evals` | 5 | Generate LLM eval tests per collection |
| mcp-patterns | `/mcp-patterns` | 4 | Tool implementation patterns reference |
| mcp-testing | `/mcp-testing` | 4-5 | Testing patterns reference |
| discuss-mcp | `/discuss-mcp` | 5 | Advisory: trace optimization, chaining, coverage |
| count-mcp-tools | `/count-mcp-tools` | 4 | Count tools per collection |

## Agents Reference

| Agent | Phase | Invoked By | Purpose |
|-------|-------|------------|---------|
| mcp-tool-creator | 4 | `/build-tools` | Creates tool files following SDK patterns |
| mcp-tool-description-writer | 4 | `/build-tools` | Writes LLM-optimized tool descriptions |
| mcp-tool-reviewer | 4 | `/build-tools` | Reviews tools for LLM-readiness |
| integration-test-creator | 4 | `/build-tools-tests` | Creates integration tests |
| integration-test-validator | 4 | `/build-tools-tests` | Validates test quality |
| test-builder-helper-creator | 4 | `/build-tools-tests` | Creates test builders and helpers |
| eval-test-creator | 5 | `/build-evals` | Creates LLM eval workflow tests |
