# Black-Box & Snapshot Testing for create-umbraco-mcp-server

## Context

The `create-umbraco-mcp-server` CLI has three commands (scaffold, init, discover) with good test coverage of individual module functions, but the tests are slow because they scaffold real projects via `execSync` (30s timeouts). The command orchestrators (`runInit`, `runDiscover`, `main`) have zero test coverage. We want fast, deterministic black-box tests that mock at the edges (fs, prompts, fetch, execSync) and snapshot tests to catch unintended template changes.

## Approach

Mock at the module boundary level using `jest.unstable_mockModule()` (the ESM-compatible way to intercept imports). Each command orchestrator imports from prompt modules, fs modules, and child_process — we intercept these before the dynamic `import()` of the module under test.

### Edge Mocking Strategy

| Edge | Mock Approach |
|------|--------------|
| **File system** (`node:fs`) | `jest.unstable_mockModule("node:fs", ...)` with in-memory file store |
| **User prompts** (`./prompts.js`) | `jest.unstable_mockModule("../prompts.js", ...)` returning canned responses |
| **Network** (`fetch`) | `globalThis.fetch = jest.fn()` (global, no module mock needed) |
| **CLI execution** (`node:child_process`) | `jest.unstable_mockModule("node:child_process", ...)` |
| **Console output** | `jest.spyOn(console, "log")` to verify key messages |
| **process.exit** | `jest.spyOn(process, "exit").mockImplementation(...)` throws to halt flow |

## Files to Create

### 1. Test Helpers (4 files)

**`src/__tests__/helpers/mock-fs.ts`** — Lightweight in-memory filesystem mock
- Takes a `Record<string, string>` of path → content mappings
- Implements: `existsSync`, `readFileSync`, `writeFileSync`, `mkdirSync`, `rmSync`, `readdirSync` (with `withFileTypes`), `statSync`, `copyFileSync`, `unlinkSync`, `rmdirSync`
- Tracks writes in a `writtenFiles` map for assertions
- Supports directory semantics (paths with children are directories)
- No external dependency needed — the CLI uses ~10 fs methods total

**`src/__tests__/helpers/mock-prompts.ts`** — Prompt response queue
- `queueResponses(mockFn, responses[])` — each call pops the next response
- Throws if more prompts are called than expected (catches flow bugs)

**`src/__tests__/helpers/mock-fetch.ts`** — URL-pattern-based fetch mock
- `setupMockFetch(routes[])` — matches URL patterns to canned responses
- Returns proper Response-like objects with `.json()`, `.text()`, `.ok`, `.status`, `.headers`

**`src/__tests__/helpers/template-fixture.ts`** — Template files as a Record
- Script-generated from `dist/template/` (only the ~15 files the CLI actually reads/edits)
- Key files: `package.json`, `src/index.ts`, `src/config/mode-registry.ts`, `src/config/slice-registry.ts`, `src/config/index.ts`, `jest.config.ts`, `orval.config.ts`, `.env.example`
- Used by mock-fs to simulate a scaffolded project without actually running scaffold

### 2. Snapshot Tests (1 file)

**`src/__tests__/template-structure.test.ts`**
- Reads `dist/template/` recursively, snapshots the sorted file listing
- Catches unintended file additions/removals to the template
- Snapshots the transformed `package.json` output for a sample project name
- Snapshots the transformed `README.md` output
- Fast — reads real filesystem but doesn't scaffold anything

### 3. Scaffold Black-Box Tests (1 file)

**`src/__tests__/scaffold.test.ts`**
- Mocks `node:fs` with mock-fs
- Tests `scaffoldProject()` with various project names
- Verifies: file exclusions applied, package.json transformed (name, bin, SDK version, description), README title replaced, directory structure created
- Snapshot: transformed package.json and README content for a standard project name
- Error cases: template not found, target exists
- Tests `toKebabCase()` directly (already exported, pure function)

### 4. Init Command Black-Box Tests (1 file)

**`src/init/__tests__/init-command.test.ts`**
- Mocks: `node:fs` (template fixture), `./prompts.js` (canned responses), `node:child_process` (for setupInstance), `process.exit`
- Scenarios:
  - **Skip Umbraco + remove all features**: verifies all 4 removal functions execute, summary shows removals
  - **Skip Umbraco + keep all features**: verifies no removal functions execute
  - **Existing instance + swagger URL**: verifies `configureOpenApi` called with URL
  - **Create instance (happy path)**: verifies `setupInstance` called, .env updated with credentials
  - **Create instance failure**: verifies error handled gracefully, continues to features
  - **Invalid project**: verifies `process.exit(1)` called with error message
  - **Partial features**: only detected features get prompted (e.g. no chaining prompt if no `src/config/mcp-servers.ts`)

### 5. Init Module Mock-FS Tests (1 file)

**`src/init/__tests__/removal-functions.test.ts`**
- Mocks `node:fs` with template fixture
- Tests each removal function (`removeMocks`, `removeExamples`, `removeChaining`, `removeEvals`) against mock filesystem
- Verifies correct files deleted, correct edits applied to index.ts/jest.config/package.json
- Snapshots the edited `src/index.ts` after each removal combination
- Tests idempotency (second call returns 0 changes)
- Tests `detectFeatures` with various mock filesystem states

### 6. Discover Command Black-Box Tests (1 file)

**`src/discover/__tests__/discover-command.test.ts`**
- Mocks: `node:fs`, `./prompts.js`, `globalThis.fetch`, `node:child_process`, `process.exit`
- Scenarios:
  - **Happy path (single API)**: health OK → swagger found → API analyzed → modes suggested → registries updated → `.discover.json` written
  - **Health check fails**: verifies `process.exit(1)` with error
  - **No swagger endpoints**: verifies `process.exit(1)` with message
  - **Multiple APIs**: user selects one from list
  - **Skip orval/generate**: verifies `configureOpenApi`/`execSync` NOT called
  - **LLM available**: Claude CLI returns modes JSON, used instead of fallback
  - **LLM unavailable**: `execSync("claude ...")` throws, fallback modes used
  - **No groups selected**: early return, no registry updates

### 7. Discover Module Mock-FS Tests (1 file)

**`src/discover/__tests__/registry-updates.test.ts`**
- Tests `updateModeRegistry`, `updateSliceRegistry`, `updateEnvBaseUrl`, `detectBaseUrl`, `configureOpenApi` with mock-fs
- Snapshots edited `mode-registry.ts` and `slice-registry.ts` after updates
- Tests priority order for `detectBaseUrl` (launchSettings > .env > orval)

## Files to Modify

**`packages/create-mcp-server/package.json`** — Replace test scripts:
```json
"test": "node --experimental-vm-modules $(npm root)/jest/bin/jest.js --runInBand"
```
No separate `test:fast` / `test:integration` split needed — all tests are now fast.

**`packages/create-mcp-server/jest.config.js`** — No changes needed (existing config already matches `**/__tests__/**/*.test.ts`)

## Existing Tests

**Delete:**
- `src/init/__tests__/init-modules.test.ts` — Every `describe` scaffolds a fresh project via `execSync` (6 scaffolds, ~2 min CI time). 100% replaced by `removal-functions.test.ts` + `init-command.test.ts` with mock-fs.

**Delete scaffold-dependent tests from `src/discover/__tests__/discover-modules.test.ts`:**
- `updateRegistries`, `detectBaseUrl`, `readLaunchSettingsUrl`, `updateEnvBaseUrl` — all scaffold real projects (30s timeout each). Fully replaced by `registry-updates.test.ts` with mock-fs.

**Keep pure-logic tests in `src/discover/__tests__/discover-modules.test.ts`:**
- `analyzeApi`, `suggestModes`, `extractPermissions`, `parseSwaggerUiHtml`, `combined workflow` — these use mock data (no scaffolding), run instantly, and test different functions than the new tests cover.

The template snapshot test (`template-structure.test.ts`) fills the gap left by removing integration tests — if the real template and the mock fixture ever diverge, the snapshot breaks.

## Implementation Order

1. Test helpers (mock-fs, mock-prompts, mock-fetch, template-fixture)
2. Template structure snapshot test
3. Scaffold black-box tests
4. Init removal-functions mock-fs tests
5. Init command black-box tests
6. Discover registry-updates mock-fs tests
7. Discover command black-box tests
8. Delete `init-modules.test.ts`, trim `discover-modules.test.ts`
9. Package.json script updates

## Verification

- `npm test -w packages/create-mcp-server` — runs all tests (should complete in <5 seconds)
- Update snapshots: add `-- -u` flag when template changes are intentional
