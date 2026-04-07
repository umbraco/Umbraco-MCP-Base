/**
 * MCP CLI Knowledge Evaluation Tests
 *
 * Tests whether an agent with the mcp-cli skill can correctly answer
 * questions about configuring and operating Umbraco MCP servers.
 *
 * Each test pair runs:
 * 1. With skill: runSkillTest (has CLI knowledge)
 * 2. Without skill: runBaselineTest (baseline — no CLI knowledge)
 *
 * "WITH" tests assert correctness. "WITHOUT" tests log results for comparison.
 */

import {
  runSkillTest,
  runBaselineTest,
  verifyOutputContains,
  verifyOutputContainsAny,
  logTestResult,
  TEST_TIMEOUT,
} from "./setup.js";

const SKILL = "mcp-cli";
const TURNS = 6;

// ============================================================================
// Setting up the server
// ============================================================================

describe("MCP CLI — Server Setup", () => {
  it(
    "WITH skill: should explain how to start the server with auth",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. How do I start an Umbraco MCP server from the CLI with authentication? I have a client ID and secret.",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const check = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_CLIENT_ID",
        ".env",
        "env",
      ]);

      if (!check.passed) logTestResult(result, "WITH skill: server setup");
      expect(check.passed).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "WITHOUT skill: baseline — start server with auth",
    async () => {
      const result = await runBaselineTest(
        "How do I start an Umbraco MCP server from the CLI with authentication? I have a client ID and secret.",
        { maxTurns: 2, maxRetries: 0 }
      );

      const check = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_CLIENT_ID",
        ".env",
      ]);

      logTestResult(result, `WITHOUT skill: server setup (passed: ${check.passed})`);
    },
    TEST_TIMEOUT
  );
});

// ============================================================================
// Claude Code configuration
// ============================================================================

describe("MCP CLI — Claude Code Config", () => {
  it(
    "WITH skill: should show Claude Code MCP server config with env block",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. How do I add an Umbraco MCP server to Claude Code's configuration? Show me the JSON config.",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const check = verifyOutputContains(result.finalResult, [
        "mcpServers",
      ]);

      const hasEnvBlock = verifyOutputContainsAny(result.finalResult, [
        '"env"',
        "env",
      ]);

      if (!check.passed || !hasEnvBlock.passed) logTestResult(result, "WITH skill: claude code config");
      expect(check.passed).toBe(true);
      expect(hasEnvBlock.passed).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "WITHOUT skill: baseline — Claude Code config",
    async () => {
      const result = await runBaselineTest(
        "How do I add an Umbraco MCP server to Claude Code's configuration? Show me the JSON config.",
        { maxTurns: 2, maxRetries: 0 }
      );

      const check = verifyOutputContainsAny(result.finalResult, [
        "mcpServers",
        "mcp_servers",
      ]);

      logTestResult(result, `WITHOUT skill: claude code config (passed: ${check.passed})`);
    },
    TEST_TIMEOUT
  );
});

// ============================================================================
// Dry-run mode
// ============================================================================

describe("MCP CLI — Dry-Run Mode", () => {
  it(
    "WITH skill: should explain dry-run and what happens to different tool types",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. I want to let an LLM try mutation tools without risk. How do I configure the server for this? What will the LLM see when it calls a create tool?",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const flagCheck = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_DRY_RUN",
        "--umbraco-dry-run",
      ]);

      const behaviorCheck = verifyOutputContainsAny(result.finalResult, [
        "preview",
        "read",
        "normally",
        "without",
      ]);

      if (!flagCheck.passed || !behaviorCheck.passed) logTestResult(result, "WITH skill: dry-run");
      expect(flagCheck.passed).toBe(true);
      expect(behaviorCheck.passed).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "WITHOUT skill: baseline — dry-run mode",
    async () => {
      const result = await runBaselineTest(
        "I want to let an LLM try Umbraco MCP mutation tools without risk. How do I configure the server?",
        { maxTurns: 2, maxRetries: 0 }
      );

      const check = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_DRY_RUN",
        "--umbraco-dry-run",
        "dry-run",
        "dry run",
      ]);

      logTestResult(result, `WITHOUT skill: dry-run (passed: ${check.passed})`);
    },
    TEST_TIMEOUT
  );
});

// ============================================================================
// Readonly mode
// ============================================================================

describe("MCP CLI — Readonly Mode", () => {
  it(
    "WITH skill: should explain readonly and that tools are removed not blocked",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. What is the difference between dry-run and readonly mode? In readonly, can the LLM still see mutation tools?",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const readonlyCheck = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_READONLY",
        "--umbraco-readonly",
      ]);

      const removedCheck = verifyOutputContainsAny(result.finalResult, [
        "removed",
        "not registered",
        "won't see",
        "will not see",
        "not available",
        "not exposed",
        "completely",
        "hidden",
      ]);

      if (!readonlyCheck.passed || !removedCheck.passed) logTestResult(result, "WITH skill: readonly vs dry-run");
      expect(readonlyCheck.passed).toBe(true);
      expect(removedCheck.passed).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "WITHOUT skill: baseline — readonly mode",
    async () => {
      const result = await runBaselineTest(
        "What is the difference between dry-run and readonly mode in an Umbraco MCP server?",
        { maxTurns: 2, maxRetries: 0 }
      );

      const check = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_READONLY",
        "--umbraco-readonly",
        "read-only",
        "readonly",
      ]);

      logTestResult(result, `WITHOUT skill: readonly (passed: ${check.passed})`);
    },
    TEST_TIMEOUT
  );
});

// ============================================================================
// Tool filtering
// ============================================================================

describe("MCP CLI — Tool Filtering", () => {
  it(
    "WITH skill: should know how to limit tools by slice",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. I want the LLM to only be able to read and list content — no create, update, or delete. How do I configure this?",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const check = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_INCLUDE_SLICES",
        "--umbraco-include-slices",
        "UMBRACO_READONLY",
        "--umbraco-readonly",
      ]);

      if (!check.passed) logTestResult(result, "WITH skill: slice filtering");
      expect(check.passed).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "WITHOUT skill: baseline — tool filtering",
    async () => {
      const result = await runBaselineTest(
        "I want an Umbraco MCP LLM to only be able to read and list content. How do I configure this?",
        { maxTurns: 2, maxRetries: 0 }
      );

      const check = verifyOutputContainsAny(result.finalResult, [
        "UMBRACO_INCLUDE_SLICES",
        "include-slices",
        "include_slices",
      ]);

      logTestResult(result, `WITHOUT skill: slice filtering (passed: ${check.passed})`);
    },
    TEST_TIMEOUT
  );
});

// ============================================================================
// Introspection
// ============================================================================

describe("MCP CLI — Introspection", () => {
  it(
    "WITH skill: should know how to discover tools before connecting",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. I've built an Umbraco MCP server but I don't know what tools it has. How can I find out without starting the server or having Umbraco running?",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const check = verifyOutputContainsAny(result.finalResult, [
        "--list-tools",
        "--describe-tool",
        "--generate-context",
        "--call",
      ]);

      const noAuthCheck = verifyOutputContainsAny(result.finalResult, [
        "not require",
        "don't need",
        "without",
        "no auth",
        "no credentials",
        "not needed",
      ]);

      if (!check.passed || !noAuthCheck.passed) logTestResult(result, "WITH skill: introspection");
      expect(check.passed).toBe(true);
      expect(noAuthCheck.passed).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "WITHOUT skill: baseline — tool discovery",
    async () => {
      const result = await runBaselineTest(
        "I've built an Umbraco MCP server but don't know what tools it has. How can I find out without starting the server?",
        { maxTurns: 2, maxRetries: 0 }
      );

      const check = verifyOutputContainsAny(result.finalResult, [
        "--list-tools",
        "list-tools",
        "--describe-tool",
      ]);

      logTestResult(result, `WITHOUT skill: introspection (passed: ${check.passed})`);
    },
    TEST_TIMEOUT
  );
});

// ============================================================================
// Secret safety
// ============================================================================

describe("MCP CLI — Secret Safety", () => {
  it(
    "WITH skill: should recommend .env or env block, not CLI args for secrets",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. How should I pass my UMBRACO_CLIENT_SECRET when starting the server?",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const envCheck = verifyOutputContainsAny(result.finalResult, [
        ".env",
        "env block",
        "environment variable",
        "env var",
      ]);

      if (!envCheck.passed) logTestResult(result, "WITH skill: secret safety");
      expect(envCheck.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});

// ============================================================================
// Config precedence
// ============================================================================

describe("MCP CLI — Config Precedence", () => {
  it(
    "WITH skill: should explain config precedence",
    async () => {
      const result = await runSkillTest(
        "Use the mcp-cli skill. If I set UMBRACO_BASE_URL in my .env file and also pass --umbraco-base-url on the CLI, which one wins?",
        SKILL,
        { maxTurns: TURNS, verbose: true }
      );

      expect(result.success).toBe(true);

      const check = verifyOutputContainsAny(result.finalResult, [
        "CLI",
        "command line",
        "flag",
        "precedence",
        "override",
        "wins",
        "takes priority",
      ]);

      if (!check.passed) logTestResult(result, "WITH skill: config precedence");
      expect(check.passed).toBe(true);
    },
    TEST_TIMEOUT
  );
});
