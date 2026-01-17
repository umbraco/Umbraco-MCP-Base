/**
 * Eval Config Tests
 *
 * Tests for the eval configuration system including:
 * - Default configuration values
 * - Configuration override via configureEvals
 * - Accessor function behavior
 * - Tool string generation
 * - Verbosity level resolution
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Store original env
const originalEnv = process.env;

// Helper to reset modules and get fresh config
async function getConfigFresh() {
  jest.resetModules();
  return await import("../config.js");
}

describe("Eval Config", () => {
  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
    delete process.env.E2E_VERBOSITY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("default configuration", () => {
    it("should have sensible defaults", async () => {
      const { getEvalConfig } = await getConfigFresh();
      const config = getEvalConfig();

      expect(config.mcpServerPath).toBe("dist/index.js");
      expect(config.mcpServerName).toBe("mcp-server");
      expect(config.serverEnv).toEqual({});
      expect(config.defaultModel).toBe("claude-3-5-haiku-20241022");
      expect(config.defaultMaxTurns).toBe(15);
      expect(config.defaultMaxBudgetUsd).toBe(0.50);
      expect(config.defaultTimeoutMs).toBe(120000);
      expect(config.defaultVerbosity).toBe("quiet");
    });

    it("should use E2E_VERBOSITY env var for default verbosity", async () => {
      process.env.E2E_VERBOSITY = "verbose";
      const { getEvalConfig } = await getConfigFresh();
      const config = getEvalConfig();

      expect(config.defaultVerbosity).toBe("verbose");
    });

    it("should handle invalid E2E_VERBOSITY gracefully", async () => {
      process.env.E2E_VERBOSITY = "invalid-level";
      const { getEvalConfig } = await getConfigFresh();
      const config = getEvalConfig();

      // Falls back to the env value since it's cast directly
      expect(config.defaultVerbosity).toBe("invalid-level");
    });
  });

  describe("configureEvals", () => {
    it("should override specific config values", async () => {
      const { configureEvals, getEvalConfig } = await getConfigFresh();

      configureEvals({
        mcpServerPath: "custom/path/server.js",
        mcpServerName: "my-custom-server"
      });

      const config = getEvalConfig();
      expect(config.mcpServerPath).toBe("custom/path/server.js");
      expect(config.mcpServerName).toBe("my-custom-server");
      // Other values should remain at defaults
      expect(config.defaultMaxTurns).toBe(15);
    });

    it("should merge serverEnv", async () => {
      const { configureEvals, getEvalConfig } = await getConfigFresh();

      configureEvals({
        serverEnv: {
          API_KEY: "secret-key",
          API_URL: "https://api.example.com"
        }
      });

      const config = getEvalConfig();
      expect(config.serverEnv.API_KEY).toBe("secret-key");
      expect(config.serverEnv.API_URL).toBe("https://api.example.com");
    });

    it("should allow overriding all values", async () => {
      const { configureEvals, getEvalConfig } = await getConfigFresh();

      configureEvals({
        mcpServerPath: "/path/to/server.js",
        mcpServerName: "test-server",
        serverEnv: { TEST: "value" },
        defaultModel: "claude-4-opus",
        defaultMaxTurns: 25,
        defaultMaxBudgetUsd: 1.00,
        defaultTimeoutMs: 60000,
        defaultVerbosity: "normal"
      });

      const config = getEvalConfig();
      expect(config.mcpServerPath).toBe("/path/to/server.js");
      expect(config.mcpServerName).toBe("test-server");
      expect(config.serverEnv).toEqual({ TEST: "value" });
      expect(config.defaultModel).toBe("claude-4-opus");
      expect(config.defaultMaxTurns).toBe(25);
      expect(config.defaultMaxBudgetUsd).toBe(1.00);
      expect(config.defaultTimeoutMs).toBe(60000);
      expect(config.defaultVerbosity).toBe("normal");
    });

    it("should accumulate multiple configure calls", async () => {
      const { configureEvals, getEvalConfig } = await getConfigFresh();

      configureEvals({ mcpServerPath: "path1.js" });
      configureEvals({ mcpServerName: "server1" });

      const config = getEvalConfig();
      expect(config.mcpServerPath).toBe("path1.js");
      expect(config.mcpServerName).toBe("server1");
    });

    it("should allow later calls to override earlier ones", async () => {
      const { configureEvals, getEvalConfig } = await getConfigFresh();

      configureEvals({ mcpServerPath: "first-path.js" });
      configureEvals({ mcpServerPath: "second-path.js" });

      const config = getEvalConfig();
      expect(config.mcpServerPath).toBe("second-path.js");
    });
  });

  describe("accessor functions", () => {
    it("should return configured values via accessor functions", async () => {
      const {
        configureEvals,
        getMcpServerPath,
        getMcpServerName,
        getServerEnv,
        getDefaultModel,
        getDefaultMaxTurns,
        getDefaultMaxBudgetUsd,
        getDefaultTimeoutMs,
        getDefaultVerbosity
      } = await getConfigFresh();

      configureEvals({
        mcpServerPath: "test/server.js",
        mcpServerName: "test-mcp",
        serverEnv: { KEY: "value" },
        defaultModel: "test-model",
        defaultMaxTurns: 10,
        defaultMaxBudgetUsd: 0.25,
        defaultTimeoutMs: 30000,
        defaultVerbosity: "verbose"
      });

      expect(getMcpServerPath()).toBe("test/server.js");
      expect(getMcpServerName()).toBe("test-mcp");
      expect(getServerEnv()).toEqual({ KEY: "value" });
      expect(getDefaultModel()).toBe("test-model");
      expect(getDefaultMaxTurns()).toBe(10);
      expect(getDefaultMaxBudgetUsd()).toBe(0.25);
      expect(getDefaultTimeoutMs()).toBe(30000);
      expect(getDefaultVerbosity()).toBe("verbose");
    });
  });

  describe("getToolsString", () => {
    it("should join tools with comma", async () => {
      const { getToolsString } = await getConfigFresh();

      const result = getToolsString(["tool-a", "tool-b", "tool-c"]);

      expect(result).toBe("tool-a,tool-b,tool-c");
    });

    it("should handle single tool", async () => {
      const { getToolsString } = await getConfigFresh();

      const result = getToolsString(["single-tool"]);

      expect(result).toBe("single-tool");
    });

    it("should handle empty array", async () => {
      const { getToolsString } = await getConfigFresh();

      const result = getToolsString([]);

      expect(result).toBe("");
    });

    it("should work with readonly arrays", async () => {
      const { getToolsString } = await getConfigFresh();

      const tools = ["read-only-a", "read-only-b"] as const;
      const result = getToolsString(tools);

      expect(result).toBe("read-only-a,read-only-b");
    });
  });

  describe("getVerbosity", () => {
    it("should return default verbosity when no options provided", async () => {
      const { getVerbosity } = await getConfigFresh();

      const result = getVerbosity();

      expect(result).toBe("quiet"); // Default
    });

    it("should return default verbosity when options is undefined", async () => {
      const { getVerbosity } = await getConfigFresh();

      const result = getVerbosity(undefined);

      expect(result).toBe("quiet");
    });

    it("should return explicit verbosity level", async () => {
      const { getVerbosity } = await getConfigFresh();

      expect(getVerbosity({ verbosity: "verbose" })).toBe("verbose");
      expect(getVerbosity({ verbosity: "normal" })).toBe("normal");
      expect(getVerbosity({ verbosity: "quiet" })).toBe("quiet");
    });

    it("should map legacy verbose flag to 'verbose' level", async () => {
      const { getVerbosity } = await getConfigFresh();

      const result = getVerbosity({ verbose: true });

      expect(result).toBe("verbose");
    });

    it("should not treat verbose=false as 'verbose'", async () => {
      const { getVerbosity } = await getConfigFresh();

      const result = getVerbosity({ verbose: false });

      expect(result).toBe("quiet"); // Falls back to default
    });

    it("should prioritize explicit verbosity over legacy verbose flag", async () => {
      const { getVerbosity } = await getConfigFresh();

      const result = getVerbosity({ verbose: true, verbosity: "quiet" });

      expect(result).toBe("quiet"); // Explicit verbosity wins
    });

    it("should use configured default verbosity", async () => {
      const { configureEvals, getVerbosity } = await getConfigFresh();

      configureEvals({ defaultVerbosity: "normal" });

      const result = getVerbosity({});

      expect(result).toBe("normal");
    });
  });
});
