/**
 * Skill Smoke Test — lightweight end-to-end verification.
 *
 * Creates ONE tool and ONE integration test to prove the full pipeline:
 *   scaffold → init → Umbraco → discover → generate → build ONE tool → test it
 *
 * Much faster than the full skill E2E (~2-3 minutes vs ~15 minutes)
 * because it only asks the agent to create a single read tool.
 *
 * Reuses the CLI E2E manifest (KEEP_E2E_ASSETS=true), or runs standalone
 * in the CLI Scaffolding E2E CI job via the manifest written by cli-e2e.test.ts.
 *
 * Requires: ANTHROPIC_API_KEY or Claude Code subscription
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
const SKIP = !manifest || !process.env.ANTHROPIC_API_KEY;
const describeOrSkip = SKIP ? describe.skip : describe;

if (!manifest) {
  console.log("[Smoke] No manifest — run CLI E2E first with KEEP_E2E_ASSETS=true");
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("[Smoke] No ANTHROPIC_API_KEY — skipping skill smoke test");
}

describeOrSkip("Skill smoke test — single tool end-to-end", () => {
  const projectDir = manifest?.projectDir ?? "";
  const baseUrl = manifest?.baseUrl ?? "";

  beforeAll(() => {
    expect(fs.existsSync(projectDir)).toBe(true);
    console.log(`[Smoke] Project: ${projectDir}`);
    console.log(`[Smoke] Umbraco: ${baseUrl}`);

    // Copy skills
    const skillsDir = path.join(projectDir, ".claude", "skills");
    const pluginsDir = path.resolve(__dirname, "../../../../plugins/skills");
    for (const skill of ["build-tools", "build-tools-tests"]) {
      const src = path.join(pluginsDir, skill);
      const dest = path.join(skillsDir, skill);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }
  }, 30_000);

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
          maxTurns: opts?.maxTurns ?? 30,
          maxBudgetUsd: opts?.maxBudget ?? 2.0,
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
          console.log(`[Smoke] Result: ${r.subtype}, turns: ${r.num_turns}, cost: $${r.total_cost_usd?.toFixed(3)}`);
        }
      }
    } finally {
      abortController.abort();
    }

    return { text, tools };
  }

  test("builds one GET tool that compiles", async () => {
    console.log("[Smoke] Building one GET tool...");

    // Pick the simplest collection from .discover.json
    const discoverPath = path.join(projectDir, ".discover.json");
    expect(fs.existsSync(discoverPath)).toBe(true);
    const discover = JSON.parse(fs.readFileSync(discoverPath, "utf-8"));
    const collections = discover.collections as Array<{ name: string; operations: Array<{ method: string }> }>;

    // Find a collection with a GET operation (simplest to build)
    const target = collections.find(c =>
      c.operations.some(op => op.method === "GET") &&
      c.name.toLowerCase() !== "server" // skip meta endpoints
    );
    expect(target).toBeDefined();
    const collectionName = target!.name;
    console.log(`[Smoke] Target collection: ${collectionName}`);

    await runSkill(`/build-tools

Build ONLY a single GET (read) tool for the "${collectionName}" group from .discover.json. Just one tool — the simplest GET operation. After creating it, run npm run compile to verify it compiles. Fix any errors.`, {
      maxTurns: 30,
      maxBudget: 2.0,
    });

    // Verify compile passes
    execFileSync("npm", ["run", "compile"], {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: "pipe",
    });

    console.log("[Smoke] GET tool compiles");
  }, 300_000);

  test("builds one integration test that passes", async () => {
    console.log("[Smoke] Building one integration test...");

    // Find tool directories that were created
    const toolsDir = path.join(projectDir, "src/umbraco-api/tools");
    const collections = fs.readdirSync(toolsDir).filter(d =>
      d !== "example" && d !== "example-2" && d !== "chained" && d !== "umbraco-server" &&
      fs.statSync(path.join(toolsDir, d)).isDirectory()
    );
    expect(collections.length).toBeGreaterThan(0);
    const collectionName = collections[0];
    console.log(`[Smoke] Target: ${collectionName}`);

    await runSkill(`/build-tools-tests

Build ONE integration test for the "${collectionName}" collection — just a single test for the GET/read tool. The Umbraco instance is at ${baseUrl} with credentials in .env. After creating the test, run it to verify it passes.`, {
      maxTurns: 30,
      maxBudget: 2.0,
    });

    // Verify test file exists
    const testDir = path.join(toolsDir, collectionName, "__tests__");
    expect(fs.existsSync(testDir)).toBe(true);

    // Run the test
    execFileSync(
      "node",
      ["--experimental-vm-modules", "node_modules/jest/bin/jest.js", `--testPathPattern=${collectionName}/__tests__`, "--runInBand"],
      {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 60_000,
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

    console.log("[Smoke] Integration test passes");
  }, 300_000);
});
