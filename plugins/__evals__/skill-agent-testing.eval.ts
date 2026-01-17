/**
 * Skill & Agent Evaluation Tests
 *
 * Tests that verify the skills and agents in this repo work correctly.
 *
 * Approach:
 * - Skills: Copy to temp .claude/skills/ dir, load via settingSources
 * - Agents: Convert to SKILL.md format, load the same way
 *
 * Note: Skills take multiple turns to load and process, so maxTurns should be 5+
 */

import { describe, it, expect } from "@jest/globals";
import {
  runSkillTest,
  runAgentContentTest,
  loadPluginContent,
  verifyOutputContainsAny,
  logTestResult,
  TEST_TIMEOUT
} from "./setup.js";

// Default turns for skill tests (need enough for: discover skill, read skill, respond)
const SKILL_TURNS = 6;

describe("Skill Testing", () => {
  describe("mcp-patterns skill", () => {
    it(
      "should provide correct GET tool structure guidance",
      async () => {
        const result = await runSkillTest(
          "Use the mcp-patterns skill to tell me: What is the correct pattern for creating a GET tool in MCP? Give me a brief code example.",
          "skills/mcp-patterns",
          { maxTurns: SKILL_TURNS, verbose: true }
        );

        expect(result.success).toBe(true);

        // Verify response includes key patterns from the skill
        const verification = verifyOutputContainsAny(result.finalResult, [
          "executeGetApiCall",
          "readOnlyHint",
          "withStandardDecorators"
        ]);

        if (!verification.passed) {
          logTestResult(result, "GET tool structure");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should explain slices correctly",
      async () => {
        const result = await runSkillTest(
          "Use the mcp-patterns skill to explain: What are slices in MCP tools? List the available slice values.",
          "skills/mcp-patterns",
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);

        // Should mention common slice types
        const verification = verifyOutputContainsAny(result.finalResult, [
          "read",
          "create",
          "delete",
          "update"
        ]);

        if (!verification.passed) {
          logTestResult(result, "Slices explanation");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should explain annotations correctly",
      async () => {
        const result = await runSkillTest(
          "Use the mcp-patterns skill: What annotations should I use for a DELETE operation in MCP?",
          "skills/mcp-patterns",
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);
        expect(result.finalResult.toLowerCase()).toContain("destructive");
      },
      TEST_TIMEOUT
    );
  });

  describe("mcp-testing skill", () => {
    it(
      "should provide test setup guidance",
      async () => {
        const result = await runSkillTest(
          "Use the mcp-testing skill: How do I set up unit tests for MCP tools? What do I need to import?",
          "skills/mcp-testing",
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);

        // Should mention key testing utilities
        const verification = verifyOutputContainsAny(result.finalResult, [
          "setupTestEnvironment",
          "createMockRequestHandlerExtra",
          "mcp-server-sdk/testing"
        ]);

        if (!verification.passed) {
          logTestResult(result, "Test setup guidance");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should explain eval test pattern",
      async () => {
        const result = await runSkillTest(
          "Use the mcp-testing skill: How do I create an eval test for MCP tools?",
          "skills/mcp-testing",
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);

        // Should mention eval test components
        const verification = verifyOutputContainsAny(result.finalResult, [
          "runScenarioTest",
          "configureEvals",
          "requiredTools"
        ]);

        if (!verification.passed) {
          logTestResult(result, "Eval test pattern");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );
  });
});

describe("Agent Testing", () => {
  describe("mcp-tool-creator agent", () => {
    it(
      "should provide GET tool creation guidance",
      async () => {
        const agentContent = loadPluginContent("agents/mcp-tool-creator.md");
        const result = await runAgentContentTest(
          "Use the mcp-tool-creator skill: What is the structure for a GET tool using @umbraco-cms/mcp-server-sdk? Just explain the pattern, don't search files.",
          agentContent,
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);

        // Agent should provide structure including key patterns
        const verification = verifyOutputContainsAny(result.finalResult, [
          "executeGetApiCall",
          "ToolDefinition",
          "handler",
          "GET"
        ]);

        if (!verification.passed) {
          logTestResult(result, "GET tool creation");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should know DELETE annotation pattern",
      async () => {
        const agentContent = loadPluginContent("agents/mcp-tool-creator.md");
        const result = await runAgentContentTest(
          "Use the mcp-tool-creator skill: What MCP annotation hints should I use for a DELETE tool in @umbraco-cms/mcp-server-sdk?",
          agentContent,
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);
        expect(result.finalResult.toLowerCase()).toContain("destructive");
      },
      TEST_TIMEOUT
    );

    it(
      "should know PUT/UPDATE annotation pattern",
      async () => {
        const agentContent = loadPluginContent("agents/mcp-tool-creator.md");
        const result = await runAgentContentTest(
          "Use the mcp-tool-creator skill: What MCP annotation hints should I use for a PUT/UPDATE tool in @umbraco-cms/mcp-server-sdk?",
          agentContent,
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);
        expect(result.finalResult.toLowerCase()).toContain("idempotent");
      },
      TEST_TIMEOUT
    );
  });

  describe("integration-test-creator agent", () => {
    it(
      "should know test setup imports",
      async () => {
        const agentContent = loadPluginContent("agents/integration-test-creator.md");
        const result = await runAgentContentTest(
          "Use the integration-test-creator skill: What imports do I need from @umbraco-cms/mcp-server-sdk for integration tests?",
          agentContent,
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);

        // Should mention key testing imports
        const verification = verifyOutputContainsAny(result.finalResult, [
          "setupTestEnvironment",
          "createMockRequestHandlerExtra",
          "mcp-server-sdk"
        ]);

        if (!verification.passed) {
          logTestResult(result, "Test setup imports");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  describe("eval-test-creator agent", () => {
    it(
      "should know eval test structure",
      async () => {
        const agentContent = loadPluginContent("agents/eval-test-creator.md");
        const result = await runAgentContentTest(
          "Use the eval-test-creator skill: What is the runScenarioTest structure for MCP eval tests?",
          agentContent,
          { maxTurns: SKILL_TURNS }
        );

        expect(result.success).toBe(true);

        // Should mention key eval components
        const verification = verifyOutputContainsAny(result.finalResult, [
          "runScenarioTest",
          "prompt",
          "tools",
          "requiredTools"
        ]);

        if (!verification.passed) {
          logTestResult(result, "Eval test structure");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );
  });
});

describe("Code Generation Quality", () => {
  describe("mcp-tool-creator generates valid patterns", () => {
    it(
      "should generate code with toolkit patterns",
      async () => {
        const agentContent = loadPluginContent("agents/mcp-tool-creator.md");
        const result = await runAgentContentTest(
          `Use the mcp-tool-creator skill: Generate a GET tool called "get-user" using @umbraco-cms/mcp-server-sdk patterns with withStandardDecorators and executeGetApiCall.`,
          agentContent,
          {
            maxTurns: SKILL_TURNS,
            allowedTools: ["Skill"] // Only skill tool, no file access
          }
        );

        expect(result.success).toBe(true);

        // Verify generated code has toolkit patterns (be lenient - any of these)
        const codePatterns = [
          "withStandardDecorators",
          "executeGetApiCall",
          "ToolDefinition"
        ];

        const verification = verifyOutputContainsAny(result.finalResult, codePatterns);

        if (!verification.passed) {
          console.log("Missing all code patterns");
          logTestResult(result, "Code generation");
        }

        expect(verification.passed).toBe(true);
      },
      TEST_TIMEOUT
    );
  });
});
