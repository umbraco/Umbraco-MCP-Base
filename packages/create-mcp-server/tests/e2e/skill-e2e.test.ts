/**
 * Skill E2E — full tool-building pipeline for a single collection.
 *
 * Proves the complete MCP development loop end-to-end:
 *   1. /build-tools — creates GET/list tools for one collection, compiles
 *   2. /build-tools-tests — creates integration tests
 *   3. Run tests — integration tests pass against running Umbraco
 *
 * Uses a single small collection (culture) to keep run time reasonable (~8 min).
 *
 * Requires:
 *   - new-instance E2E manifest (run new-instance E2E with KEEP_E2E_ASSETS=true first)
 *   - Claude Code subscription or ANTHROPIC_API_KEY
 *   - Running Umbraco instance (from new-instance E2E)
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

if (!manifest) {
  console.log("[Skill E2E] No manifest — run new-instance E2E first with KEEP_E2E_ASSETS=true");
}

describeOrSkip("Skill E2E — build tool and integration test", () => {
  const projectDir = manifest?.projectDir ?? "";
  const baseUrl = manifest?.baseUrl ?? "";
  let targetCollection = "";

  beforeAll(() => {
    expect(fs.existsSync(projectDir)).toBe(true);
    console.log(`[Skill E2E] Project: ${projectDir}`);
    console.log(`[Skill E2E] Umbraco: ${baseUrl}`);

    // The spawned Claude Code process reads project .claude/settings.json (settingSources:
    // ["project"]) which requires the workspace to be marked trusted, even under
    // permissionMode: "bypassPermissions". Pre-accept the trust dialog for this project dir.
    const claudeConfigPath = path.join(os.homedir(), ".claude.json");
    const claudeConfig = fs.existsSync(claudeConfigPath)
      ? JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8"))
      : {};
    claudeConfig.projects = claudeConfig.projects ?? {};
    claudeConfig.projects[projectDir] = {
      ...claudeConfig.projects[projectDir],
      hasTrustDialogAccepted: true,
    };
    fs.writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));

    // Copy skills into the project
    const skillsDir = path.join(projectDir, ".claude", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const pluginsDir = path.resolve(__dirname, "../../../../plugins/umbraco-mcp-skills/skills");
    for (const skill of ["build-tools", "build-tools-tests"]) {
      const src = path.join(pluginsDir, skill);
      const dest = path.join(skillsDir, skill);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }

    // Pick a collection from .discover.json
    // The discover manifest lists collection names (the agent resolves operations from swagger)
    const discoverPath = path.join(projectDir, ".discover.json");
    expect(fs.existsSync(discoverPath)).toBe(true);
    const discover = JSON.parse(fs.readFileSync(discoverPath, "utf-8"));
    const collections = discover.collections as string[];
    expect(collections.length).toBeGreaterThan(0);

    // Use "culture" or "language" if available (small, read-heavy), otherwise first
    targetCollection = collections.find(c => c === "culture") ??
      collections.find(c => c === "language") ??
      collections[0];
    console.log(`[Skill E2E] Target: ${targetCollection}`);
  }, 30_000);

  async function runSkill(prompt: string, opts?: { maxTurns?: number; maxBudget?: number }): Promise<{ text: string; tools: string[] }> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    let text = "";
    const tools: string[] = [];
    const abortController = new AbortController();

    try {
      try {
        for await (const message of query({
          prompt,
          options: {
            model: "sonnet",
            cwd: projectDir,
            settingSources: ["project"],
            allowedTools: ["Skill", "Read", "Glob", "Grep", "Write", "Edit", "Bash"],
            permissionMode: "bypassPermissions",
            maxTurns: opts?.maxTurns ?? 40,
            maxBudgetUsd: opts?.maxBudget ?? 3.0,
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
      } catch (err) {
        // Some SDK versions throw "Claude Code returned an error result: <reason>"
        // instead of yielding a graceful "result" message when a turn/budget/length
        // ceiling is hit mid-run. Log and fall through with whatever partial
        // transcript was captured — the downstream file/compile assertions are the
        // real pass/fail signal for this step.
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[Skill E2E] Result: query error — ${message}`);
        if (!/^claude code returned an error result:/i.test(message)) {
          throw err;
        }
      }
    } finally {
      abortController.abort();
    }

    return { text, tools };
  }

  // ── Step 1: Build tools ─────────────────────────────────────────────────
  test("Step 1: /build-tools creates collection that compiles", async () => {
    console.log(`[Skill E2E] Building tools for ${targetCollection}...`);

    await runSkill(`/build-tools

Build tools ONLY for the "${targetCollection}" group from .discover.json. Build ONLY the GET (read by ID) and GET (list) operations — just two tools maximum. Skip create, update, delete. After creating the tools, run npm run compile to verify they compile cleanly. Fix any TypeScript errors.`, {
      maxTurns: 30,
      maxBudget: 2.0,
    });

    // Verify the collection directory exists
    const toolsDir = path.join(projectDir, "src/umbraco-api/tools");
    const collectionDir = fs.readdirSync(toolsDir).find(d =>
      d !== "example" && d !== "example-2" && d !== "chained" && d !== "umbraco-server" &&
      fs.statSync(path.join(toolsDir, d)).isDirectory()
    );
    expect(collectionDir).toBeDefined();
    targetCollection = collectionDir!;

    // Verify compile passes (exclude worker.ts — file: refs cause type duplication)
    const tsconfigPath = path.join(projectDir, "tsconfig.json");
    if (fs.existsSync(path.join(projectDir, "tsconfig.e2e.json"))) {
      execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.e2e.json"], {
        cwd: projectDir, encoding: "utf-8", timeout: 60_000, stdio: "pipe",
      });
    } else {
      execFileSync("npm", ["run", "compile"], {
        cwd: projectDir, encoding: "utf-8", timeout: 60_000, stdio: "pipe",
      });
    }

    console.log(`[Skill E2E] Step 1 passed: ${targetCollection} tools compile`);
  }, 600_000);

  // ── Step 2: Build tests (builders, helpers, integration tests) ──────────
  test("Step 2: /build-tools-tests creates tests that pass", async () => {
    console.log(`[Skill E2E] Building tests for ${targetCollection}...`);

    await runSkill(`/build-tools-tests

Build integration tests for the "${targetCollection}" collection. The Umbraco instance is running at ${baseUrl} with API credentials in .env. Create:
1. A builder for test data if needed (read-only tools may not need one)
2. Integration tests for the GET tools only
3. Run the tests to verify they pass

Only test the read/list tools — do not create tests for mutations.`, {
      maxTurns: 30,
      maxBudget: 2.0,
    });

    // Verify test directory exists with test files
    const toolsDir = path.join(projectDir, "src/umbraco-api/tools", targetCollection);
    const testDir = path.join(toolsDir, "__tests__");
    expect(fs.existsSync(testDir)).toBe(true);

    const testFiles = (fs.readdirSync(testDir, { recursive: true }) as string[])
      .filter((f: string) => f.endsWith(".test.ts"));
    expect(testFiles.length).toBeGreaterThan(0);

    console.log(`[Skill E2E] ${testFiles.length} test file(s) created`);

    // Run the integration tests
    try {
      execFileSync(
        "node",
        [
          "--experimental-vm-modules",
          "node_modules/jest/bin/jest.js",
          `--testPathPatterns=${targetCollection}/__tests__`,
          "--runInBand",
        ],
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
      console.log("[Skill E2E] Step 2 passed: integration tests pass");
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      if (e.stdout) console.log("[test stdout]", e.stdout.slice(-3000));
      if (e.stderr) console.log("[test stderr]", e.stderr.slice(-3000));
      throw err;
    }
  }, 600_000);
});
