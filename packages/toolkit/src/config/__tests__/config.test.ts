/**
 * Config module tests
 *
 * Tests for the configuration parsing system including:
 * - CLI argument parsing
 * - Environment variable fallback
 * - CLI precedence over ENV
 * - CSV parsing for array fields
 * - Required field validation
 * - Source tracking accuracy
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Store original values to restore after tests
const originalArgv = process.argv;
const originalEnv = process.env;
const originalExit = process.exit;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

import type { ConfigFieldDefinition, GetServerConfigOptions } from "../config.js";

// Helper to reset modules between tests (since config may cache state)
async function getServerConfigFresh(isStdioMode: boolean, options?: GetServerConfigOptions) {
  // Clear module cache to get fresh config each time
  jest.resetModules();
  const { getServerConfig } = await import("../config.js");
  return getServerConfig(isStdioMode, options);
}

// Backwards-compatible helper that returns just the config
async function getBaseConfigFresh(isStdioMode: boolean) {
  const result = await getServerConfigFresh(isStdioMode);
  return result.config;
}

// Non-existent env file path to prevent loading default .env
const NON_EXISTENT_ENV_FILE = "/tmp/non-existent-env-file-for-testing.env";

describe("getServerConfig", () => {
  let exitCode: number | undefined;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    // Reset test state
    exitCode = undefined;
    consoleOutput = [];
    consoleErrors = [];

    // Mock process.exit to capture exit code instead of actually exiting
    (process.exit as any) = jest.fn((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    });

    // Mock console.log to capture output
    console.log = jest.fn((...args: any[]) => {
      consoleOutput.push(args.join(" "));
    });

    // Mock console.error to capture errors
    console.error = jest.fn((...args: any[]) => {
      consoleErrors.push(args.join(" "));
    });

    // Start with clean environment
    process.env = { ...originalEnv };
    // Clear any Umbraco-related env vars
    Object.keys(process.env).forEach(key => {
      if (key.startsWith("UMBRACO_")) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    // Restore original values
    process.argv = originalArgv;
    process.env = originalEnv;
    (process.exit as any) = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe("CLI argument parsing", () => {
    it("should parse --umbraco-client-id from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.clientId).toBe("test-client-id");
      expect(config.configSources.clientId).toBe("cli");
    });

    it("should parse --umbraco-client-secret from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "my-secret-value",
        "--umbraco-base-url", "http://localhost:5000"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.clientSecret).toBe("my-secret-value");
      expect(config.configSources.clientSecret).toBe("cli");
    });

    it("should parse --umbraco-base-url from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "https://my-umbraco.example.com"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.baseUrl).toBe("https://my-umbraco.example.com");
      expect(config.configSources.baseUrl).toBe("cli");
    });

    it("should parse --umbraco-tool-modes as CSV from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-tool-modes", "content,media,editor"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.toolModes).toEqual(["content", "media", "editor"]);
      expect(config.configSources.toolModes).toBe("cli");
    });

    it("should parse --umbraco-include-tool-collections as CSV from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-include-tool-collections", "document,media,data-type"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.includeToolCollections).toEqual(["document", "media", "data-type"]);
      expect(config.configSources.includeToolCollections).toBe("cli");
    });

    it("should parse --umbraco-exclude-tool-collections as CSV from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-exclude-tool-collections", "user,member"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.excludeToolCollections).toEqual(["user", "member"]);
      expect(config.configSources.excludeToolCollections).toBe("cli");
    });

    it("should parse --umbraco-include-slices as CSV from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-include-slices", "create,read,tree"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.includeSlices).toEqual(["create", "read", "tree"]);
      expect(config.configSources.includeSlices).toBe("cli");
    });

    it("should parse --umbraco-exclude-slices as CSV from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-exclude-slices", "delete,recycle-bin"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.excludeSlices).toEqual(["delete", "recycle-bin"]);
      expect(config.configSources.excludeSlices).toBe("cli");
    });

    it("should parse --umbraco-include-tools as CSV from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-include-tools", "get-document,create-document"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.includeTools).toEqual(["get-document", "create-document"]);
      expect(config.configSources.includeTools).toBe("cli");
    });

    it("should parse --umbraco-exclude-tools as CSV from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-exclude-tools", "delete-document,empty-recycle-bin"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.excludeTools).toEqual(["delete-document", "empty-recycle-bin"]);
      expect(config.configSources.excludeTools).toBe("cli");
    });

    it("should parse --umbraco-readonly as boolean from CLI", async () => {
      process.argv = ["node", "index.js",
        "--umbraco-client-id", "test-client-id",
        "--umbraco-client-secret", "test-secret",
        "--umbraco-base-url", "http://localhost:5000",
        "--umbraco-readonly"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.readonly).toBe(true);
      expect(config.configSources.readonly).toBe("cli");
    });
  });

  describe("Environment variable fallback", () => {
    it("should read UMBRACO_CLIENT_ID from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.clientId).toBe("env-client-id");
      expect(config.configSources.clientId).toBe("env");
    });

    it("should read UMBRACO_CLIENT_SECRET from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret-value";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.clientSecret).toBe("env-secret-value");
      expect(config.configSources.clientSecret).toBe("env");
    });

    it("should read UMBRACO_BASE_URL from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "https://env-umbraco.example.com";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.baseUrl).toBe("https://env-umbraco.example.com");
      expect(config.configSources.baseUrl).toBe("env");
    });

    it("should parse UMBRACO_TOOL_MODES as CSV from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_TOOL_MODES = "content,media,users";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.toolModes).toEqual(["content", "media", "users"]);
      expect(config.configSources.toolModes).toBe("env");
    });

    it("should parse UMBRACO_INCLUDE_TOOL_COLLECTIONS as CSV from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_INCLUDE_TOOL_COLLECTIONS = "document,media";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.includeToolCollections).toEqual(["document", "media"]);
      expect(config.configSources.includeToolCollections).toBe("env");
    });

    it("should parse UMBRACO_EXCLUDE_SLICES as CSV from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_EXCLUDE_SLICES = "delete,publish";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.excludeSlices).toEqual(["delete", "publish"]);
      expect(config.configSources.excludeSlices).toBe("env");
    });

    it("should parse UMBRACO_READONLY as boolean from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_READONLY = "true";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.readonly).toBe(true);
      expect(config.configSources.readonly).toBe("env");
    });

    it("should not set readonly when UMBRACO_READONLY is false", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_READONLY = "false";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.readonly).toBeUndefined();
    });
  });

  describe("CLI precedence over ENV", () => {
    it("should prefer CLI clientId over ENV", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js",
        "--env", NON_EXISTENT_ENV_FILE,
        "--umbraco-client-id", "cli-client-id"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.clientId).toBe("cli-client-id");
      expect(config.configSources.clientId).toBe("cli");
    });

    it("should prefer CLI clientSecret over ENV", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js",
        "--env", NON_EXISTENT_ENV_FILE,
        "--umbraco-client-secret", "cli-secret"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.auth.clientSecret).toBe("cli-secret");
      expect(config.configSources.clientSecret).toBe("cli");
    });

    it("should prefer CLI toolModes over ENV", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_TOOL_MODES = "content,media";
      process.argv = ["node", "index.js",
        "--env", NON_EXISTENT_ENV_FILE,
        "--umbraco-tool-modes", "editor,admin"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.toolModes).toEqual(["editor", "admin"]);
      expect(config.configSources.toolModes).toBe("cli");
    });

    it("should prefer CLI includeSlices over ENV", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_INCLUDE_SLICES = "create,read";
      process.argv = ["node", "index.js",
        "--env", NON_EXISTENT_ENV_FILE,
        "--umbraco-include-slices", "tree,search"
      ];

      const config = await getBaseConfigFresh(true);

      expect(config.includeSlices).toEqual(["tree", "search"]);
      expect(config.configSources.includeSlices).toBe("cli");
    });
  });

  describe("CSV parsing", () => {
    it("should trim whitespace from CSV values", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_TOOL_MODES = " content , media , users ";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.toolModes).toEqual(["content", "media", "users"]);
    });

    it("should filter empty values from CSV", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_TOOL_MODES = "content,,media,,,users";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.toolModes).toEqual(["content", "media", "users"]);
    });

    it("should handle single value (no comma)", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_TOOL_MODES = "content";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const config = await getBaseConfigFresh(true);

      expect(config.toolModes).toEqual(["content"]);
    });
  });

  describe("Required field validation", () => {
    it("should exit with error if clientId is missing", async () => {
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      await expect(getBaseConfigFresh(true)).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some(e => e.includes("UMBRACO_CLIENT_ID"))).toBe(true);
    });

    it("should exit with error if clientSecret is missing", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      await expect(getBaseConfigFresh(true)).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some(e => e.includes("UMBRACO_CLIENT_SECRET"))).toBe(true);
    });

    it("should exit with error if baseUrl is missing", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      await expect(getBaseConfigFresh(true)).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some(e => e.includes("UMBRACO_BASE_URL"))).toBe(true);
    });
  });

  describe("Source tracking", () => {
    it("should track all config sources correctly", async () => {
      process.env.UMBRACO_CLIENT_ID = "env-client-id";
      process.env.UMBRACO_CLIENT_SECRET = "env-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_TOOL_MODES = "content";
      process.argv = ["node", "index.js",
        "--env", NON_EXISTENT_ENV_FILE,
        "--umbraco-include-slices", "create,read"
      ];

      const config = await getBaseConfigFresh(true);

      // Auth fields from env
      expect(config.configSources.clientId).toBe("env");
      expect(config.configSources.clientSecret).toBe("env");
      expect(config.configSources.baseUrl).toBe("env");

      // toolModes from env
      expect(config.configSources.toolModes).toBe("env");

      // includeSlices from cli
      expect(config.configSources.includeSlices).toBe("cli");

      // Not set fields should be "none"
      expect(config.configSources.excludeToolCollections).toBe("none");
      expect(config.configSources.excludeSlices).toBe("none");
      expect(config.configSources.excludeTools).toBe("none");
    });
  });

  describe("Console output in non-stdio mode", () => {
    it("should log configuration in non-stdio mode", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      await getBaseConfigFresh(false); // isStdioMode = false

      expect(consoleOutput.some(o => o.includes("Umbraco MCP Configuration"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("UMBRACO_CLIENT_ID"))).toBe(true);
      expect(consoleOutput.some(o => o.includes("UMBRACO_BASE_URL"))).toBe(true);
    });

    it("should mask clientSecret in logs", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "my-long-secret-value";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      await getBaseConfigFresh(false); // isStdioMode = false

      // Should contain masked secret (****alue)
      const secretLog = consoleOutput.find(o => o.includes("UMBRACO_CLIENT_SECRET"));
      expect(secretLog).toBeDefined();
      expect(secretLog).toContain("****");
      expect(secretLog).not.toContain("my-long-secret-value");
    });

    it("should not log in stdio mode", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      await getBaseConfigFresh(true); // isStdioMode = true

      expect(consoleOutput.some(o => o.includes("Umbraco MCP Configuration"))).toBe(false);
    });
  });

  describe("Additional fields (custom config)", () => {
    const customFields: ConfigFieldDefinition[] = [
      { name: "myFeatureEnabled", envVar: "MY_FEATURE_ENABLED", cliFlag: "my-feature-enabled", type: "boolean" },
      { name: "customEndpoints", envVar: "MY_CUSTOM_ENDPOINTS", cliFlag: "my-custom-endpoints", type: "csv" },
      { name: "apiKey", envVar: "MY_API_KEY", cliFlag: "my-api-key", type: "string" },
    ];

    it("should parse additional string fields from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.MY_API_KEY = "my-secret-api-key";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const { config, custom } = await getServerConfigFresh(true, { additionalFields: customFields });

      expect(config.auth.clientId).toBe("test-client");
      expect(custom.apiKey).toBe("my-secret-api-key");
    });

    it("should parse additional boolean fields from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.MY_FEATURE_ENABLED = "true";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const { custom } = await getServerConfigFresh(true, { additionalFields: customFields });

      expect(custom.myFeatureEnabled).toBe(true);
    });

    it("should parse additional CSV fields from env", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.MY_CUSTOM_ENDPOINTS = "endpoint1,endpoint2,endpoint3";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const { custom } = await getServerConfigFresh(true, { additionalFields: customFields });

      expect(custom.customEndpoints).toEqual(["endpoint1", "endpoint2", "endpoint3"]);
    });

    it("should parse additional fields from CLI", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = [
        "node", "index.js",
        "--env", NON_EXISTENT_ENV_FILE,
        "--my-api-key", "cli-api-key",
        "--my-custom-endpoints", "cli-ep1,cli-ep2",
      ];

      const { custom } = await getServerConfigFresh(true, { additionalFields: customFields });

      expect(custom.apiKey).toBe("cli-api-key");
      expect(custom.customEndpoints).toEqual(["cli-ep1", "cli-ep2"]);
    });

    it("should prefer CLI over env for additional fields", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.MY_API_KEY = "env-api-key";
      process.argv = [
        "node", "index.js",
        "--env", NON_EXISTENT_ENV_FILE,
        "--my-api-key", "cli-api-key",
      ];

      const { custom } = await getServerConfigFresh(true, { additionalFields: customFields });

      expect(custom.apiKey).toBe("cli-api-key");
    });

    it("should keep base config and custom config separate", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.env.UMBRACO_READONLY = "true";
      process.env.MY_API_KEY = "my-api-key";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const { config, custom } = await getServerConfigFresh(true, { additionalFields: customFields });

      // Base config should have readonly
      expect(config.readonly).toBe(true);
      // Custom should have api key
      expect(custom.apiKey).toBe("my-api-key");
      // Custom should not have readonly
      expect(custom).not.toHaveProperty("readonly");
    });

    it("should return empty custom object when no additional fields provided", async () => {
      process.env.UMBRACO_CLIENT_ID = "test-client";
      process.env.UMBRACO_CLIENT_SECRET = "test-secret";
      process.env.UMBRACO_BASE_URL = "http://localhost:5000";
      process.argv = ["node", "index.js", "--env", NON_EXISTENT_ENV_FILE];

      const { config, custom } = await getServerConfigFresh(true);

      expect(config.auth.clientId).toBe("test-client");
      expect(Object.keys(custom)).toHaveLength(0);
    });
  });
});
