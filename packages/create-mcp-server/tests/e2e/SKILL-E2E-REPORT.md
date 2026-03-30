# Skill E2E Test Results & Improvement Report

## Test Results (4 runs against Language API group)

| Run | /build-tools | Compiles? | /build-tools-tests | Tests pass? | Cost |
|-----|-------------|-----------|-------------------|-------------|------|
| 1 | 45 turns ✓ | ✓ | timed out (300s) | ✓ (partial) | ~$2.50 |
| 2 | 46 turns ✓ | ✓ | timed out (900s) | N/A | ~$3.00 |
| 3 | 51 turns ✗ | ✗ | N/A | N/A | ~$1.50 |
| 4 | 46 turns ✓ | ✗ | 60 turns ✓ | ✓ (all) | ~$4.60 |
| 5 | 55 turns ✓ | ✗ (dirty state) | 60 turns ✓ | ✓ (all) | ~$4.90 |
| 6* | 46 turns ✓ | ✓ | 73 turns ✓ | ✗ pattern error | ~$4.10 |

\* After skill improvements (compile-per-file, better builder template, snapshot revert)

**Current state:** build-tools reliably compiles from clean state. build-tools-tests creates correct structure but tests have consistent `result.content[0].text` access pattern error.

---

## Issue 1: /build-tools sometimes leaves compile errors

**Severity:** High — blocks everything downstream

**What happens:** The skill creates tool files, registers them in index.ts and collections.ts, but sometimes generates code that doesn't compile. The skill is told to "run npm run compile and fix errors" but doesn't always complete the fix loop within the turn budget.

**Root causes:**
- The generated Orval client has complex types (e.g., `CreateLanguageRequestModel` vs the Zod schema shape) that don't match the tool pattern exactly
- Import paths for Zod schemas and client methods need to be derived from the generated code, but the skill sometimes guesses wrong
- The "compile → fix" loop is expensive (each iteration costs turns) and the skill doesn't always prioritize it

**Improvements to build-tools skill:**
1. **Add a "compile checkpoint" after each tool file** — not just at the end. Currently tools are batch-created, then compiled. If the first tool has an error, all subsequent tools inherit the wrong pattern.
2. **Include the exact import patterns from the generated client** in the skill instructions. Currently the skill reads the generated files but sometimes misinterprets the type signatures.
3. **Reduce tool complexity** — the skill creates elaborate input/output schema handling. Simpler tools (direct `executeGetApiCall` usage) compile more reliably.

---

## Issue 2: /build-tools-tests needs 10+ minutes

**Severity:** Medium — works but slow

**What happens:** The skill needs 60+ turns ($3+) to create a full test suite (setup.ts, builder, helper, builder tests, integration tests). This is because it follows a sequential process with compile-after-each-step checkpoints.

**Root causes:**
- The skill workflow has 8 steps, each requiring reading patterns, writing code, compiling, and fixing
- The builder pattern is complex (fluent interface, cleanup, find-by-name) and the skill generates it from scratch each time
- Each `npm run compile` call within the Agent SDK costs a turn

**Improvements to build-tools-tests skill:**
1. **Provide concrete builder templates** rather than abstract patterns. The skill.md shows pseudocode (`// Call the create tool's handler or API client directly`) — if it showed a complete working example, the skill would copy the pattern instead of reinventing it.
2. **Skip the builder test step** for the E2E — it adds 5-10 turns for marginal value. The integration tests already test the builder indirectly.
3. **Consider pre-generating the setup.ts** during the build-tools step, since it always follows the same pattern (initializeUmbracoFetch + configureApiClient + re-exports).

---

## Issue 3: Test builder creates data that conflicts across test files

**Severity:** Medium — causes false test failures

**What happens:** The builder creates languages with unique ISO codes per test file, but doesn't clean up between files. When test files run sequentially, earlier files consume ISO codes that later files try to reuse, causing 400 Bad Request errors.

**Root causes:**
- The `usedIsoCodes` set is in-memory per process, but doesn't account for data already in the database from previous test files
- The builder's "delete existing before create" logic sometimes fails silently
- There's no global test cleanup (afterAll) that removes all test languages

**Improvements:**
1. **Add global cleanup** — the skill should generate an `afterAll` in the setup.ts that cleans up all test-created entities
2. **Use more unique identifiers** — instead of cycling through a fixed list of ISO codes, generate truly unique codes per test run
3. **Add the cleanup pattern to the builder skill template** — the current template shows `cleanup(namePrefix)` but the generated builders don't always implement it correctly

---

## Issue 4: Generated tests access tool results incorrectly

**Severity:** High — causes all tests to fail with the same error

**What happens:** The generated tests access `result.content[0].text` directly, but tool handlers return structured results where `content` may be undefined or structured differently depending on the SDK's output mode.

**Root cause:** The build-tools-tests skill.md shows a snapshot pattern with `createSnapshotResult(result, id)` but the skill generates raw property access instead. The skill is not following its own instructions.

**Fix:** Strengthen the skill.md integration test pattern to explicitly say:
- NEVER access `result.content[0].text` directly
- ALWAYS use `createSnapshotResult(result, id)` + `toMatchSnapshot()` for success cases
- For error cases, only check `result.isError`
- Add a negative example showing what NOT to do

---

## Issue 5: Skill output is non-deterministic

**Severity:** Expected — inherent to LLM-based code generation

**What happens:** Same prompt produces different code across runs. Sometimes it compiles, sometimes it doesn't. Sometimes it creates 5 tools, sometimes 7.

**Mitigation (not a fix):**
1. **Run skill E2E multiple times** and track pass rate — aim for >80%
2. **Make the skill prompts more constrained** — fewer choices = more consistent output
3. **Pin to specific models** — sonnet is used now; opus might be more reliable but slower/costlier
4. **Accept non-determinism** — the skill E2E is a regression baseline, not a gate

---

## Recommended Skill Improvements (Priority Order)

### 1. Add compile-after-each-file to build-tools (High impact)

Currently in skill.md step 3b, tools are created in batch. Change to:
```
For each tool file:
  1. Create the file
  2. Run npm run compile
  3. Fix any errors in the file just created
  4. Only proceed to next tool if compile passes
```

### 2. Provide complete builder example in build-tools-tests (High impact)

Replace the pseudocode builder template with a fully working example that:
- Uses the API client directly (not tool handlers)
- Includes proper cleanup in afterAll
- Shows the exact CAPTURE_RAW_HTTP_RESPONSE pattern
- Includes error handling for "entity already exists"

### 3. Generate setup.ts during build-tools (Medium impact)

Move the setup.ts creation from build-tools-tests to build-tools. It always follows the same pattern and having it early means compile checks work for the test infrastructure too.

### 4. Add global test cleanup pattern (Medium impact)

Add to the build-tools-tests skill template:
```typescript
afterAll(async () => {
  await EntityTestHelper.cleanup("_Test");
});
```
And ensure the cleanup function is robust (list all, filter by prefix, delete each).

### 5. Improve the skill E2E diagnostic output (Low impact)

- Capture tsc stderr properly (current `stdio: "pipe"` doesn't always work)
- Log which specific tool files have compile errors
- Log the generated file listing after each skill run

---

## Workflow Recommendation

The three-step workflow works well for iterating:

```bash
# Once: create project with Umbraco running
KEEP_E2E_ASSETS=true TEST_SQL=... npm run test:e2e

# Iterate: run skills, check results, revert, improve skill, repeat
npm run test:e2e:skills    # run skills
npm run test:e2e:revert    # reset for next attempt
# (improve skill.md)
npm run test:e2e:skills    # try again

# Done: clean up
npm run test:e2e:cleanup
```

Target: build-tools should compile >90% of the time, build-tools-tests should produce passing tests >80% of the time.
