/**
 * MCP CLI Tool Calling Eval Tests
 *
 * Tests that an agent WITH the mcp-cli skill can actually compose and
 * execute CLI commands via Bash. The agent uses skill knowledge to:
 * - Run introspection commands (--list-tools, --describe-tool, --generate-context)
 * - Interpret the output correctly
 * - Answer questions based on the CLI output
 *
 * These evals require the template to be built (dist/index.js must exist).
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  runSkillTest,
  verifyOutputContains,
  verifyOutputContainsAny,
  logTestResult,
  TEST_TIMEOUT,
} from "./setup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILL_PATH = "skills/mcp-cli";
const TURNS = 8;

// Absolute path to the built template binary (relative to repo root)
const SERVER_BIN = resolve(__dirname, "../../../template/dist/index.js");

// Common allowed tools — Skill for loading knowledge, Bash for running commands
const ALLOWED_TOOLS = ["Skill", "Bash", "Read"];

describe("CLI Tool Calling — List Tools", () => {
  it(
    "agent runs --list-tools and reports the tool names",
    async () => {
      const result = await runSkillTest(
        `Use the mcp-cli skill to learn how to list tools, then run the command against this server binary: ${SERVER_BIN}

Run the command and tell me: how many tools are there, and what are their names?`,
        SKILL_PATH,
        { maxTurns: TURNS, allowedTools: ALLOWED_TOOLS, verbose: true }
      );

      expect(result.success).toBe(true);

      // Agent should have used Bash to run the CLI
      const bashCalls = result.toolCalls.filter((tc) => tc.name === "Bash");
      expect(bashCalls.length).toBeGreaterThan(0);

      // Should mention actual tool names from the template
      const check = verifyOutputContainsAny(result.finalResult, [
        "get-example",
        "list-examples",
        "create-example",
      ]);

      if (!check.passed) logTestResult(result, "list tools");
      expect(check.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});

describe("CLI Tool Calling — Describe Tool", () => {
  it(
    "agent runs --describe-tool and reports the schema",
    async () => {
      const result = await runSkillTest(
        `Use the mcp-cli skill to learn how to describe a tool, then run the command to describe the "get-example" tool using this server binary: ${SERVER_BIN}

What parameters does get-example accept? What type is the id field?`,
        SKILL_PATH,
        { maxTurns: TURNS, allowedTools: ALLOWED_TOOLS, verbose: true }
      );

      expect(result.success).toBe(true);

      const bashCalls = result.toolCalls.filter((tc) => tc.name === "Bash");
      expect(bashCalls.length).toBeGreaterThan(0);

      // Should report the id parameter and its type
      const check = verifyOutputContainsAny(result.finalResult, [
        "id",
        "uuid",
        "string",
      ]);

      if (!check.passed) logTestResult(result, "describe tool");
      expect(check.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});

describe("CLI Tool Calling — Generate Context", () => {
  it(
    "agent runs --generate-context and summarises the output",
    async () => {
      const result = await runSkillTest(
        `Use the mcp-cli skill to learn how to generate context documentation, then run the command against this server binary: ${SERVER_BIN}

Summarise what collections and tools the server has.`,
        SKILL_PATH,
        { maxTurns: TURNS, allowedTools: ALLOWED_TOOLS, verbose: true }
      );

      expect(result.success).toBe(true);

      const bashCalls = result.toolCalls.filter((tc) => tc.name === "Bash");
      expect(bashCalls.length).toBeGreaterThan(0);

      // Should mention collections from the template
      const check = verifyOutputContainsAny(result.finalResult, [
        "example",
        "widget",
        "collection",
      ]);

      if (!check.passed) logTestResult(result, "generate context");
      expect(check.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});

describe("CLI Tool Calling — Analyse Tool Annotations", () => {
  it(
    "agent uses --list-tools to identify which tools are read-only vs destructive",
    async () => {
      const result = await runSkillTest(
        `Use the mcp-cli skill, then run the list-tools command against: ${SERVER_BIN}

Look at the output and tell me:
1. Which tools are read-only?
2. Which tools are destructive?
3. Which tools are neither?`,
        SKILL_PATH,
        { maxTurns: TURNS, allowedTools: ALLOWED_TOOLS, verbose: true }
      );

      expect(result.success).toBe(true);

      const bashCalls = result.toolCalls.filter((tc) => tc.name === "Bash");
      expect(bashCalls.length).toBeGreaterThan(0);

      // Should identify delete-example as destructive
      const destructiveCheck = verifyOutputContainsAny(result.finalResult, [
        "delete-example",
        "destructive",
      ]);

      // Should identify get/list/search as read-only
      const readOnlyCheck = verifyOutputContainsAny(result.finalResult, [
        "get-example",
        "list-examples",
        "read-only",
        "read only",
      ]);

      if (!destructiveCheck.passed || !readOnlyCheck.passed) {
        logTestResult(result, "analyse annotations");
      }

      expect(destructiveCheck.passed).toBe(true);
      expect(readOnlyCheck.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});

describe("CLI Tool Calling — Filtered List Tools", () => {
  it(
    "agent runs --list-tools with UMBRACO_READONLY=true and only sees read-only tools",
    async () => {
      const result = await runSkillTest(
        `Use the mcp-cli skill to learn how introspection and filtering work together, then run the list-tools command against this server binary: ${SERVER_BIN}

Set the UMBRACO_READONLY=true environment variable when running the command. Tell me which tools appear and confirm that no mutation tools (create, update, delete) are listed.`,
        SKILL_PATH,
        { maxTurns: TURNS, allowedTools: ALLOWED_TOOLS, verbose: true }
      );

      expect(result.success).toBe(true);

      const bashCalls = result.toolCalls.filter((tc) => tc.name === "Bash");
      expect(bashCalls.length).toBeGreaterThan(0);

      // Should mention read-only tools
      const readOnlyCheck = verifyOutputContainsAny(result.finalResult, [
        "get-example",
        "list-examples",
        "get-widget",
      ]);

      // Should confirm mutation tools are absent
      const noMutationCheck = verifyOutputContainsAny(result.finalResult, [
        "no mutation",
        "no create",
        "no delete",
        "not listed",
        "not included",
        "not present",
        "excluded",
        "filtered",
        "only read",
        "read-only",
      ]);

      if (!readOnlyCheck.passed || !noMutationCheck.passed) {
        logTestResult(result, "filtered list tools");
      }

      expect(readOnlyCheck.passed).toBe(true);
      expect(noMutationCheck.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});

describe("CLI Tool Calling — Describe Then Compare", () => {
  it(
    "agent describes two tools and compares their schemas",
    async () => {
      const result = await runSkillTest(
        `Use the mcp-cli skill, then describe both "get-example" and "create-example" using the server binary: ${SERVER_BIN}

Compare the two tools: what parameters does each accept? Which one is read-only?`,
        SKILL_PATH,
        { maxTurns: TURNS, allowedTools: ALLOWED_TOOLS, verbose: true }
      );

      expect(result.success).toBe(true);

      // Should have run --describe-tool at least twice (or once with each)
      const bashCalls = result.toolCalls.filter((tc) => tc.name === "Bash");
      expect(bashCalls.length).toBeGreaterThanOrEqual(2);

      // Should compare parameters
      const check = verifyOutputContainsAny(result.finalResult, [
        "id",
        "name",
        "read-only",
        "readOnly",
      ]);

      if (!check.passed) logTestResult(result, "describe and compare");
      expect(check.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});
