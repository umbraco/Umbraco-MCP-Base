/**
 * CLI Eval Test Setup
 *
 * Tests CLI knowledge and tool-calling by giving the agent the mcp-cli
 * skill from the template. The skill ships with every scaffolded project
 * and can be customised per downstream package.
 *
 * The agent gets:
 * - A temporary directory with the skill copied from template/.claude/skills/
 * - Access to Bash (for tool-calling tests) to run CLI commands
 * - The built template binary path for running real commands
 */

// Polyfill Symbol.asyncDispose for Jest VM context compatibility
(Symbol as any).asyncDispose ??= Symbol.for("Symbol.asyncDispose");
(Symbol as any).dispose ??= Symbol.for("Symbol.dispose");

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "fs";
import { join, dirname, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TEST_TIMEOUT = 120_000;

// Path to template skills (the source of truth for the mcp-cli skill)
const TEMPLATE_SKILLS_DIR = resolve(__dirname, "../../../template/.claude/skills");

// Path to built template binary
export const SERVER_BIN = resolve(__dirname, "../../../template/dist/index.js");

/**
 * Result type for eval tests
 */
export interface EvalTestResult {
  finalResult: string;
  success: boolean;
  toolCalls: Array<{ name: string; input: unknown }>;
  cost: number;
  turns: number;
}

/**
 * Options for running an eval test
 */
export interface EvalTestOptions {
  /** Tools to allow the agent to use */
  allowedTools?: string[];
  /** Maximum conversation turns */
  maxTurns?: number;
  /** Maximum budget in USD */
  maxBudget?: number;
  /** Whether to log verbose output */
  verbose?: boolean;
  /** Number of retries on failure (default: 2, so 3 total attempts) */
  maxRetries?: number;
}

/**
 * Creates a temporary project directory with the mcp-cli skill from the template.
 * The agent loads this via settingSources: ["project"].
 */
function setupSkillTestDirectory(skillName: string): string {
  const tempDir = join(tmpdir(), `cli-eval-${Date.now()}`);
  const skillsDir = join(tempDir, ".claude", "skills");
  mkdirSync(skillsDir, { recursive: true });

  const sourcePath = join(TEMPLATE_SKILLS_DIR, skillName);
  const destPath = join(skillsDir, skillName);
  cpSync(sourcePath, destPath, { recursive: true });

  return tempDir;
}

/**
 * Creates a temporary project with a baseline CLAUDE.md (no skill).
 */
function setupBaselineDirectory(): string {
  const tempDir = join(tmpdir(), `cli-eval-baseline-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(
    join(tempDir, "CLAUDE.md"),
    "# Assistant\n\nYou are a helpful assistant. Answer questions to the best of your ability.\n"
  );
  return tempDir;
}

function cleanupTestDirectory(dir: string): void {
  if (existsSync(dir) && dir.includes("cli-eval")) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================================
// Core query execution
// ============================================================================

async function executeQuery(
  prompt: string,
  testDir: string,
  options: EvalTestOptions
): Promise<EvalTestResult> {
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let result: SDKResultMessage | undefined;
  let assistantText = "";
  const abortController = new AbortController();

  try {
    const allowedTools = options.allowedTools ?? ["Skill", "Read", "Glob", "Grep"];
    const maxTurns = options.maxTurns ?? 5;
    const maxBudget = options.maxBudget ?? 0.10;

    try {
      for await (const message of query({
        prompt,
        options: {
          model: "haiku",
          cwd: testDir,
          settingSources: ["project"],
          allowedTools,
          permissionMode: "bypassPermissions",
          maxTurns,
          maxBudgetUsd: maxBudget,
          abortController,
          env: { ...process.env, CLAUDECODE: "" },
        }
      })) {
        if (message.type === "system" && message.subtype === "init") {
          if (options.verbose) {
            console.log("Available tools:", (message as any).tools?.length || 0);
          }
        }
        if (message.type === "assistant" && message.message.content) {
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              toolCalls.push({ name: block.name, input: block.input });
              if (options.verbose) {
                console.log(`Tool call: ${block.name}`);
              }
            } else if (block.type === "text") {
              assistantText += block.text + "\n";
              if (options.verbose) {
                console.log(`Assistant: ${block.text.substring(0, 200)}...`);
              }
            }
          }
        }
        if (message.type === "result") {
          result = message;
        }
      }
    } catch (err) {
      // Some SDK versions throw instead of yielding a "result" message with
      // subtype error_max_turns/error_prompt_too_long when a turn/length
      // ceiling is hit. Tests deliberately probe these ceilings (tight
      // maxTurns baselines) and only need the partial transcript, not a
      // hard failure — so treat these specific ceilings as an unsuccessful
      // (not fatal) result and let anything else propagate.
      const message = err instanceof Error ? err.message : String(err);
      if (/reached maximum number of turns|prompt is too long/i.test(message)) {
        return {
          finalResult: assistantText.trim(),
          success: false,
          toolCalls,
          cost: 0,
          turns: 0,
        };
      }
      throw err;
    }

    const isSuccess = result?.subtype === "success";
    const isMaxTurns = result?.subtype === "error_max_turns";
    const finalText = isSuccess ? result.result : assistantText.trim();

    return {
      finalResult: finalText,
      success: isSuccess || (isMaxTurns && assistantText.length > 0),
      toolCalls,
      cost: (result as any)?.total_cost_usd || 0,
      turns: (result as any)?.num_turns || 0
    };
  } finally {
    abortController.abort();
  }
}

async function withRetry(
  fn: () => Promise<EvalTestResult>,
  maxRetries: number,
  verbose?: boolean
): Promise<EvalTestResult> {
  let lastResult: EvalTestResult | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await fn();
    if (lastResult.success) return lastResult;
    if (attempt < maxRetries && verbose) {
      console.log(`Attempt ${attempt + 1} failed, retrying...`);
    }
  }
  return lastResult!;
}

// ============================================================================
// Public test runners
// ============================================================================

/**
 * Run an eval test with the mcp-cli skill loaded from the template.
 */
export async function runSkillTest(
  prompt: string,
  skillName: string,
  options: EvalTestOptions = {}
): Promise<EvalTestResult> {
  const testDir = setupSkillTestDirectory(skillName);
  const maxRetries = options.maxRetries ?? 2;

  if (options.verbose) {
    console.log(`Test directory: ${testDir}`);
  }

  try {
    return await withRetry(
      () => executeQuery(prompt, testDir, options),
      maxRetries,
      options.verbose
    );
  } finally {
    cleanupTestDirectory(testDir);
  }
}

/**
 * Run a baseline eval test without the skill (for comparison).
 */
export async function runBaselineTest(
  prompt: string,
  options: EvalTestOptions = {}
): Promise<EvalTestResult> {
  const testDir = setupBaselineDirectory();
  const maxRetries = options.maxRetries ?? 2;

  try {
    return await withRetry(
      () => executeQuery(prompt, testDir, options),
      maxRetries,
      options.verbose
    );
  } finally {
    cleanupTestDirectory(testDir);
  }
}

// ============================================================================
// Verification helpers
// ============================================================================

export function verifyOutputContains(
  output: string,
  patterns: string[]
): { passed: boolean; missing: string[] } {
  const missing = patterns.filter(
    (p) => !output.toLowerCase().includes(p.toLowerCase())
  );
  return { passed: missing.length === 0, missing };
}

export function verifyOutputContainsAny(
  output: string,
  patterns: string[]
): { passed: boolean; found: string[] } {
  const found = patterns.filter(
    (p) => output.toLowerCase().includes(p.toLowerCase())
  );
  return { passed: found.length > 0, found };
}

export function logTestResult(result: EvalTestResult, testName?: string): void {
  if (testName) console.log(`\n=== ${testName} ===`);
  console.log(`Success: ${result.success}`);
  console.log(`Tools called: ${result.toolCalls.map((t) => t.name).join(", ") || "none"}`);
  console.log(`Cost: $${result.cost.toFixed(4)}`);
  console.log(`Turns: ${result.turns}`);
  console.log(`Response preview: ${result.finalResult.substring(0, 300)}...`);
}
