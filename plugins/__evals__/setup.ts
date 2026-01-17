/**
 * Skill/Agent/Command Eval Test Setup
 *
 * Tests skills, agents, and commands by:
 * 1. Creating a temporary .claude/ directory structure
 * 2. Copying skills to .claude/skills/ and commands to .claude/commands/
 * 3. Using settingSources to load them properly
 *
 * SDK filesystem locations:
 * - Skills: .claude/skills/<name>/SKILL.md
 * - Commands: .claude/commands/<name>.md
 */

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Timeout for LLM-based tests
export const TEST_TIMEOUT = 120_000;

// Path to plugins directory
const PLUGINS_DIR = join(__dirname, "..");

/**
 * Loads a skill, agent, or command markdown file content
 */
export function loadPluginContent(relativePath: string): string {
  return readFileSync(join(PLUGINS_DIR, relativePath), "utf-8");
}

/**
 * Result type for skill/agent tests
 */
export interface SkillTestResult {
  finalResult: string;
  success: boolean;
  toolCalls: Array<{ name: string; input: unknown }>;
  cost: number;
  turns: number;
}

/**
 * Options for running a skill/agent test
 */
export interface SkillTestOptions {
  /** Tools to allow the agent to use */
  allowedTools?: string[];
  /** Maximum conversation turns */
  maxTurns?: number;
  /** Maximum budget in USD */
  maxBudget?: number;
  /** Whether to log verbose output */
  verbose?: boolean;
}

/**
 * Creates a temporary project directory with .claude/skills/ structure
 * and copies the specified skill into it.
 *
 * @param skillSourcePath - Relative path to skill directory (e.g., "skills/mcp-patterns")
 * @returns Path to the temporary project directory
 */
export function setupSkillTestDirectory(skillSourcePath: string): string {
  const tempDir = join(tmpdir(), `skill-test-${Date.now()}`);
  const skillsDir = join(tempDir, ".claude", "skills");

  // Create .claude/skills/ structure
  mkdirSync(skillsDir, { recursive: true });

  // Copy the skill directory
  const sourcePath = join(PLUGINS_DIR, skillSourcePath);
  const skillName = skillSourcePath.split("/").pop()!;
  const destPath = join(skillsDir, skillName);

  cpSync(sourcePath, destPath, { recursive: true });

  return tempDir;
}

/**
 * Converts agent markdown format to skill format.
 * Agents have YAML with: name, description, tools, model
 * Skills need: name, description
 */
function convertAgentToSkillFormat(agentContent: string, skillName: string): string {
  // Check if it has YAML frontmatter
  if (agentContent.startsWith("---")) {
    const endYaml = agentContent.indexOf("---", 3);
    if (endYaml > 0) {
      const yaml = agentContent.substring(3, endYaml);
      const body = agentContent.substring(endYaml + 3);

      // Extract name and description from YAML
      const nameMatch = yaml.match(/^name:\s*(.+)$/m);
      const descMatch = yaml.match(/^description:\s*(.+)$/m);

      const name = nameMatch ? nameMatch[1].trim() : skillName;
      const description = descMatch ? descMatch[1].trim() : "Agent skill for testing";

      // Create clean skill YAML
      return `---
name: ${name}
description: ${description}
---
${body}`;
    }
  }
  // If no YAML, add minimal frontmatter
  return `---
name: ${skillName}
description: Agent skill for testing
---

${agentContent}`;
}

/**
 * Creates a temporary project with skill content written directly
 *
 * @param skillName - Name for the skill
 * @param skillContent - The SKILL.md content (can be agent format)
 * @returns Path to the temporary project directory
 */
export function setupSkillTestDirectoryFromContent(
  skillName: string,
  skillContent: string
): string {
  const tempDir = join(tmpdir(), `skill-test-${Date.now()}`);
  const skillDir = join(tempDir, ".claude", "skills", skillName);

  // Create skill directory
  mkdirSync(skillDir, { recursive: true });

  // Convert agent format to skill format if needed
  const cleanedContent = convertAgentToSkillFormat(skillContent, skillName);

  // Write SKILL.md
  writeFileSync(join(skillDir, "SKILL.md"), cleanedContent);

  return tempDir;
}

/**
 * Creates a temporary project with a command file
 *
 * @param commandName - Name for the command (becomes /command-name)
 * @param commandContent - The command markdown content
 * @returns Path to the temporary project directory
 */
export function setupCommandTestDirectory(
  commandName: string,
  commandContent: string
): string {
  const tempDir = join(tmpdir(), `cmd-test-${Date.now()}`);
  const commandsDir = join(tempDir, ".claude", "commands");

  // Create .claude/commands/ structure
  mkdirSync(commandsDir, { recursive: true });

  // Write command file (filename becomes command name)
  writeFileSync(join(commandsDir, `${commandName}.md`), commandContent);

  return tempDir;
}

/**
 * Cleans up a temporary test directory
 */
export function cleanupTestDirectory(dir: string): void {
  if (existsSync(dir) && (dir.includes("skill-test-") || dir.includes("cmd-test-"))) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run an agent test with a skill loaded via the SDK's native skill loading
 *
 * @param prompt - The task prompt to send
 * @param skillSourcePath - Relative path to skill (e.g., "skills/mcp-patterns")
 * @param options - Test options
 */
export async function runSkillTest(
  prompt: string,
  skillSourcePath: string,
  options: SkillTestOptions = {}
): Promise<SkillTestResult> {
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let result: SDKResultMessage | undefined;

  // Create temp directory with skill
  const testDir = setupSkillTestDirectory(skillSourcePath);

  // Create AbortController for proper cleanup
  const abortController = new AbortController();

  try {
    const allowedTools = options.allowedTools ?? ["Skill", "Read", "Glob", "Grep"];
    const maxTurns = options.maxTurns ?? 5;
    const maxBudget = options.maxBudget ?? 0.10;

    if (options.verbose) {
      console.log(`Test directory: ${testDir}`);
      console.log(`Skill path: ${join(testDir, ".claude", "skills")}`);
    }

    // Collect assistant text responses
    let assistantText = "";

    for await (const message of query({
      prompt,
      options: {
        model: "haiku",
        cwd: testDir,
        settingSources: ["project"],  // Load skills from .claude/skills/
        allowedTools,
        permissionMode: "bypassPermissions",
        maxTurns,
        maxBudgetUsd: maxBudget,
        abortController
      }
    })) {
      // Log init message to see available skills
      if (message.type === "system" && message.subtype === "init") {
        if (options.verbose) {
          const initMsg = message as any;
          console.log("Available tools:", initMsg.tools?.length || 0);
          console.log("Slash commands:", initMsg.slash_commands || []);
        }
      }
      // Track tool calls and collect text
      if (message.type === "assistant" && message.message.content) {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            toolCalls.push({
              name: block.name,
              input: block.input
            });
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

      // Capture final result
      if (message.type === "result") {
        result = message;
      }
    }

    // Handle different result types
    const isSuccess = result?.subtype === "success";
    const isMaxTurns = result?.subtype === "error_max_turns";

    // For max_turns, we still have useful content from assistant messages
    if (isMaxTurns && options.verbose) {
      console.log(`Max turns reached after ${(result as any)?.num_turns || 0} turns`);
    }

    // Use the official result if success, otherwise use collected assistant text
    const finalText = isSuccess ? result.result : assistantText.trim();

    return {
      finalResult: finalText,
      success: isSuccess || (isMaxTurns && assistantText.length > 0), // Treat max_turns with content as success
      toolCalls,
      cost: (result as any)?.total_cost_usd || 0,
      turns: (result as any)?.num_turns || 0
    };
  } finally {
    // Abort any lingering processes
    abortController.abort();
    // Clean up temp directory
    cleanupTestDirectory(testDir);
  }
}

/**
 * Run an agent test with agent/skill content injected directly
 * (for testing agents that aren't proper SKILL.md files)
 *
 * @param prompt - The task prompt to send
 * @param agentContent - The agent markdown content
 * @param options - Test options
 */
export async function runAgentContentTest(
  prompt: string,
  agentContent: string,
  options: SkillTestOptions = {}
): Promise<SkillTestResult> {
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let result: SDKResultMessage | undefined;
  let assistantText = "";

  // Create temp directory with agent content as a skill
  const testDir = setupSkillTestDirectoryFromContent("test-agent", agentContent);

  // Create AbortController for proper cleanup
  const abortController = new AbortController();

  try {
    const allowedTools = options.allowedTools ?? ["Skill", "Read", "Glob", "Grep"];
    const maxTurns = options.maxTurns ?? 5;
    const maxBudget = options.maxBudget ?? 0.10;

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
        abortController
      }
    })) {
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
    // Abort any lingering processes
    abortController.abort();
    cleanupTestDirectory(testDir);
  }
}

/**
 * Run a test with a custom command loaded via the SDK
 *
 * @param commandName - Name for the command (will be invoked as /command-name)
 * @param commandContent - The command markdown content
 * @param commandArgs - Optional arguments to pass to the command
 * @param options - Test options
 */
export async function runCommandTest(
  commandName: string,
  commandContent: string,
  commandArgs: string = "",
  options: SkillTestOptions = {}
): Promise<SkillTestResult> {
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let result: SDKResultMessage | undefined;
  let assistantText = "";

  // Create temp directory with command
  const testDir = setupCommandTestDirectory(commandName, commandContent);

  // Create AbortController for proper cleanup
  const abortController = new AbortController();

  try {
    const allowedTools = options.allowedTools ?? ["Read", "Glob", "Grep"];
    const maxTurns = options.maxTurns ?? 5;
    const maxBudget = options.maxBudget ?? 0.10;

    // Invoke the command with optional args
    const prompt = commandArgs ? `/${commandName} ${commandArgs}` : `/${commandName}`;

    for await (const message of query({
      prompt,
      options: {
        model: "haiku",
        cwd: testDir,
        settingSources: ["project"],  // Load commands from .claude/commands/
        allowedTools,
        permissionMode: "bypassPermissions",
        maxTurns,
        maxBudgetUsd: maxBudget,
        abortController
      }
    })) {
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
    // Abort any lingering processes
    abortController.abort();
    cleanupTestDirectory(testDir);
  }
}

/**
 * Verify the output contains expected patterns (case-insensitive)
 */
export function verifyOutputContains(
  output: string,
  patterns: string[]
): { passed: boolean; missing: string[] } {
  const missing = patterns.filter(
    (p) => !output.toLowerCase().includes(p.toLowerCase())
  );
  return {
    passed: missing.length === 0,
    missing
  };
}

/**
 * Verify the output contains at least one of the patterns
 */
export function verifyOutputContainsAny(
  output: string,
  patterns: string[]
): { passed: boolean; found: string[] } {
  const found = patterns.filter(
    (p) => output.toLowerCase().includes(p.toLowerCase())
  );
  return {
    passed: found.length > 0,
    found
  };
}

/**
 * Log test result for debugging
 */
export function logTestResult(result: SkillTestResult, testName?: string): void {
  if (testName) {
    console.log(`\n=== ${testName} ===`);
  }
  console.log(`Success: ${result.success}`);
  console.log(`Tools called: ${result.toolCalls.map((t) => t.name).join(", ") || "none"}`);
  console.log(`Cost: $${result.cost.toFixed(4)}`);
  console.log(`Turns: ${result.turns}`);
  console.log(`Response preview: ${result.finalResult.substring(0, 300)}...`);
}
