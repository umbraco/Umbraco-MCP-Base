/**
 * Skill E2E test for /build-tools and /build-tools-tests.
 *
 * Uses Claude Agent SDK to run the actual skills against a scaffolded project
 * with a running Umbraco instance.
 *
 * Workflow:
 *   1. Run CLI E2E first with KEEP_E2E_ASSETS=true to create the project
 *   2. Run this test to exercise the skills against the preserved project
 *   3. Run CLI E2E cleanup to tear down
 *
 * Commands:
 *   # Step 1: Create project + start Umbraco (keeps assets)
 *   KEEP_E2E_ASSETS=true TEST_SQL_CONNECTION_STRING="..." npm run test:e2e -w packages/create-mcp-server
 *
 *   # Step 2: Run skill tests (reuses project from step 1)
 *   npm run test:e2e:skills -w packages/create-mcp-server
 *
 *   # Step 3: Clean up (kills Umbraco, drops DB, removes temp dir)
 *   npm run test:e2e:cleanup -w packages/create-mcp-server
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const MANIFEST_PATH = path.join(os.tmpdir(), "mcp-e2e-manifest.json");

interface E2eManifest {
  projectDir: string;
  instanceDir: string;
  baseUrl: string;
  dbName: string;
  umbracoProcessPid?: number;
}

function loadManifest(): E2eManifest | undefined {
  if (!fs.existsSync(MANIFEST_PATH)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  } catch {
    return undefined;
  }
}

const manifest = loadManifest();
const SKIP = !manifest;
const describeOrSkip = SKIP ? describe.skip : describe;

if (SKIP) {
  console.log("[Skill E2E] No manifest found. Run CLI E2E first with KEEP_E2E_ASSETS=true:");
  console.log(`  KEEP_E2E_ASSETS=true TEST_SQL_CONNECTION_STRING="..." npm run test:e2e -w packages/create-mcp-server`);
}

describeOrSkip("Build-tools skill E2E", () => {
  const projectDir = manifest?.projectDir ?? "";
  const baseUrl = manifest?.baseUrl ?? "";

  beforeAll(() => {
    // Verify the project still exists and Umbraco is reachable
    expect(fs.existsSync(projectDir)).toBe(true);
    console.log(`[Skill E2E] Project: ${projectDir}`);
    console.log(`[Skill E2E] Umbraco: ${baseUrl}`);

    // Ensure skills are copied
    const skillsDir = path.join(projectDir, ".claude", "skills");
    const pluginsDir = path.resolve(__dirname, "../../../../plugins/skills");
    for (const skill of ["build-tools", "build-tools-tests", "mcp-patterns", "mcp-testing"]) {
      const src = path.join(pluginsDir, skill);
      const dest = path.join(skillsDir, skill);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }

    // Copy agents
    const agentsDir = path.join(projectDir, ".claude", "agents");
    const pluginAgentsDir = path.resolve(__dirname, "../../../../plugins/agents");
    if (fs.existsSync(pluginAgentsDir) && !fs.existsSync(agentsDir)) {
      fs.cpSync(pluginAgentsDir, agentsDir, { recursive: true });
    }
  }, 30_000);

  // Helper to run a skill via Agent SDK
  async function runSkill(prompt: string, opts?: { maxTurns?: number; maxBudget?: number }): Promise<{ text: string; tools: string[] }> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    let text = "";
    const tools: string[] = [];
    const abortController = new AbortController();

    try {
      for await (const message of query({
        prompt,
        options: {
          model: "sonnet",
          cwd: projectDir,
          settingSources: ["project"],
          allowedTools: ["Skill", "Read", "Glob", "Grep", "Write", "Edit", "Bash"],
          permissionMode: "bypassPermissions",
          maxTurns: opts?.maxTurns ?? 80,
          maxBudgetUsd: opts?.maxBudget ?? 8.0,
          abortController,
          env: { ...process.env, CLAUDECODE: "" },
        },
      })) {
        if (message.type === "assistant" && message.message.content) {
          for (const block of message.message.content) {
            if (block.type === "text") text += block.text + "\n";
            if (block.type === "tool_use") tools.push(block.name);
          }
        }
        if (message.type === "result") {
          const r = message as unknown as { subtype?: string; num_turns?: number; total_cost_usd?: number };
          console.log(`[Skill E2E] Result: ${r.subtype}, turns: ${r.num_turns}, cost: $${r.total_cost_usd?.toFixed(3)}`);
        }
      }
    } finally {
      abortController.abort();
    }

    return { text, tools };
  }

  // ── Step 1: /build-tools creates Language collection ────────────────────
  test("Step 1: /build-tools creates Language collection that compiles", async () => {
    console.log("[Skill E2E] Running /build-tools for Language...");
    await runSkill(`/build-tools

Build tools ONLY for the "Language" group from .discover.json. This is a simple CRUD collection with list, get, create, update, and delete operations. Do NOT build tools for any other group. After creating the tools, run npm run compile to verify they compile cleanly. Fix any TypeScript errors.`);

    // Verify tools created
    const toolsDir = path.join(projectDir, "src/umbraco-api/tools/language");
    if (!fs.existsSync(toolsDir)) {
      const toolsParent = path.join(projectDir, "src/umbraco-api/tools");
      if (fs.existsSync(toolsParent)) {
        console.log(`[Skill E2E] Tools dir contents: ${fs.readdirSync(toolsParent).join(", ")}`);
      }
    }
    expect(fs.existsSync(toolsDir)).toBe(true);

    // Verify compile passes
    try {
      execFileSync("npm", ["run", "compile"], {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 60_000,
        stdio: "pipe",
      });
      console.log("[Skill E2E] Step 1 passed: Language tools compile cleanly");
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      console.log("[Skill E2E] Compile errors after build-tools:");
      if (e.stdout) console.log(e.stdout.slice(-2000));
      if (e.stderr) console.log(e.stderr.slice(-2000));
      throw new Error("Language tools don't compile — skill needs improvement");
    }
  }, 900_000);

  // ── Step 2: /build-tools-tests creates integration tests ────────────────
  test("Step 2: /build-tools-tests creates Language tests", async () => {
    console.log("[Skill E2E] Running /build-tools-tests for Language...");
    await runSkill(`/build-tools-tests

Build integration tests ONLY for the "language" collection. The Umbraco instance is running at ${baseUrl} with API credentials in .env. After creating the tests, run them to verify they pass.`);

    // Verify test files created
    const testDir = path.join(projectDir, "src/umbraco-api/tools/language/__tests__");
    expect(fs.existsSync(testDir)).toBe(true);

    const testFiles = fs.readdirSync(testDir, { recursive: true }) as string[];
    const testTsFiles = testFiles.filter((f: string) => f.endsWith(".test.ts"));
    expect(testTsFiles.length).toBeGreaterThan(0);

    console.log(`[Skill E2E] Step 2 passed: ${testTsFiles.length} test files created`);
  }, 900_000);

  // ── Step 3: Integration tests pass ──────────────────────────────────────
  test("Step 3: Language integration tests pass", () => {
    console.log("[Skill E2E] Running Language integration tests...");
    try {
      execFileSync(
        "node",
        ["--experimental-vm-modules", "node_modules/jest/bin/jest.js", "--testPathPattern=language/__tests__", "--runInBand"],
        {
          cwd: projectDir,
          encoding: "utf-8",
          timeout: 120_000,
          stdio: "pipe",
          env: {
            ...process.env,
            UMBRACO_BASE_URL: baseUrl,
            UMBRACO_CLIENT_ID: "umbraco-back-office-mcp",
            UMBRACO_CLIENT_SECRET: "1234567890",
            NODE_TLS_REJECT_UNAUTHORIZED: "0",
          },
        },
      );
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      if (e.stdout) console.log("[test stdout]", e.stdout.slice(-3000));
      if (e.stderr) console.log("[test stderr]", e.stderr.slice(-3000));
      throw err;
    }

    console.log("[Skill E2E] Step 3 passed: Language integration tests pass");
  }, 180_000);
});
