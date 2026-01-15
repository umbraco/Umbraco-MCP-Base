/**
 * Server Config Integration Tests
 *
 * Tests for the extensible config system using custom fields.
 * Demonstrates how consuming packages can add their own config fields.
 *
 * Note: These tests mock getServerConfig from the toolkit since
 * the toolkit's own tests verify the core config parsing works correctly.
 * These tests verify the server-config module's interface and caching.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock the toolkit's getServerConfig before importing our module
const mockGetServerConfig = jest.fn();
jest.unstable_mockModule("@umbraco-cms/mcp-toolkit", () => ({
  getServerConfig: mockGetServerConfig,
}));

// Import our module after setting up mocks
const { loadServerConfig, clearConfigCache, getCustomFieldDefinitions } =
  await import("../server-config.js");

describe("Server Config", () => {
  beforeEach(() => {
    // Clear config cache and reset mocks before each test
    clearConfigCache();
    mockGetServerConfig.mockReset();
  });

  describe("loadServerConfig", () => {
    it("should return combined umbraco and custom config", () => {
      mockGetServerConfig.mockReturnValue({
        config: {
          auth: {
            clientId: "test-client",
            clientSecret: "test-secret",
            baseUrl: "http://localhost:5000",
          },
          readonly: true,
          configSources: {
            clientId: "env",
            clientSecret: "env",
            baseUrl: "env",
            readonly: "env",
            envFile: "default",
          },
        },
        custom: {
          experimentalFeatures: true,
          externalApiKey: "my-api-key",
          customEndpoints: ["ep1", "ep2"],
        },
      });

      const { umbraco, custom } = loadServerConfig(true);

      // Verify base config
      expect(umbraco.auth.clientId).toBe("test-client");
      expect(umbraco.auth.baseUrl).toBe("http://localhost:5000");
      expect(umbraco.readonly).toBe(true);

      // Verify custom config
      expect(custom.experimentalFeatures).toBe(true);
      expect(custom.externalApiKey).toBe("my-api-key");
      expect(custom.customEndpoints).toEqual(["ep1", "ep2"]);
    });

    it("should pass isStdioMode to getServerConfig", () => {
      mockGetServerConfig.mockReturnValue({
        config: {
          auth: { clientId: "x", clientSecret: "x", baseUrl: "x" },
          configSources: { clientId: "env", clientSecret: "env", baseUrl: "env", envFile: "default" },
        },
        custom: {},
      });

      loadServerConfig(true);
      expect(mockGetServerConfig).toHaveBeenCalledWith(true, expect.any(Object));

      clearConfigCache();
      loadServerConfig(false);
      expect(mockGetServerConfig).toHaveBeenCalledWith(false, expect.any(Object));
    });

    it("should pass additionalFields to getServerConfig", () => {
      mockGetServerConfig.mockReturnValue({
        config: {
          auth: { clientId: "x", clientSecret: "x", baseUrl: "x" },
          configSources: { clientId: "env", clientSecret: "env", baseUrl: "env", envFile: "default" },
        },
        custom: {},
      });

      loadServerConfig(true);

      expect(mockGetServerConfig).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          additionalFields: expect.arrayContaining([
            expect.objectContaining({ name: "experimentalFeatures" }),
            expect.objectContaining({ name: "customEndpoints" }),
            expect.objectContaining({ name: "externalApiKey" }),
            expect.objectContaining({ name: "maxPageSize" }),
          ]),
        })
      );
    });

    it("should cache config after first load", () => {
      mockGetServerConfig.mockReturnValue({
        config: {
          auth: { clientId: "cached", clientSecret: "x", baseUrl: "x" },
          configSources: { clientId: "env", clientSecret: "env", baseUrl: "env", envFile: "default" },
        },
        custom: { externalApiKey: "cached-key" },
      });

      // First call
      const first = loadServerConfig(true);
      expect(mockGetServerConfig).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const second = loadServerConfig(true);
      expect(mockGetServerConfig).toHaveBeenCalledTimes(1);

      // Both should return same data
      expect(first.umbraco.auth.clientId).toBe("cached");
      expect(second.umbraco.auth.clientId).toBe("cached");
      expect(first.custom.externalApiKey).toBe("cached-key");
      expect(second.custom.externalApiKey).toBe("cached-key");
    });

    it("should reload config after clearConfigCache", () => {
      mockGetServerConfig
        .mockReturnValueOnce({
          config: {
            auth: { clientId: "first", clientSecret: "x", baseUrl: "x" },
            configSources: { clientId: "env", clientSecret: "env", baseUrl: "env", envFile: "default" },
          },
          custom: {},
        })
        .mockReturnValueOnce({
          config: {
            auth: { clientId: "second", clientSecret: "x", baseUrl: "x" },
            configSources: { clientId: "env", clientSecret: "env", baseUrl: "env", envFile: "default" },
          },
          custom: {},
        });

      const first = loadServerConfig(true);
      expect(first.umbraco.auth.clientId).toBe("first");

      clearConfigCache();

      const second = loadServerConfig(true);
      expect(second.umbraco.auth.clientId).toBe("second");
      expect(mockGetServerConfig).toHaveBeenCalledTimes(2);
    });
  });

  describe("custom config interface", () => {
    it("should handle undefined custom values", () => {
      mockGetServerConfig.mockReturnValue({
        config: {
          auth: { clientId: "x", clientSecret: "x", baseUrl: "x" },
          configSources: { clientId: "env", clientSecret: "env", baseUrl: "env", envFile: "default" },
        },
        custom: {},
      });

      const { custom } = loadServerConfig(true);

      expect(custom.experimentalFeatures).toBeUndefined();
      expect(custom.externalApiKey).toBeUndefined();
      expect(custom.customEndpoints).toBeUndefined();
      expect(custom.maxPageSize).toBeUndefined();
    });

    it("should type custom values correctly", () => {
      mockGetServerConfig.mockReturnValue({
        config: {
          auth: { clientId: "x", clientSecret: "x", baseUrl: "x" },
          configSources: { clientId: "env", clientSecret: "env", baseUrl: "env", envFile: "default" },
        },
        custom: {
          experimentalFeatures: true,
          customEndpoints: ["a", "b"],
          externalApiKey: "key",
          maxPageSize: "50",
        },
      });

      const { custom } = loadServerConfig(true);

      // TypeScript type checks (these verify the interface is correct)
      const boolVal: boolean | undefined = custom.experimentalFeatures;
      const arrVal: string[] | undefined = custom.customEndpoints;
      const strVal: string | undefined = custom.externalApiKey;
      const pageSize: string | undefined = custom.maxPageSize;

      expect(typeof boolVal).toBe("boolean");
      expect(Array.isArray(arrVal)).toBe(true);
      expect(typeof strVal).toBe("string");
      expect(typeof pageSize).toBe("string");
    });
  });

  describe("getCustomFieldDefinitions", () => {
    it("should return all custom field definitions", () => {
      const fields = getCustomFieldDefinitions();

      expect(fields).toHaveLength(4);
      expect(fields.map(f => f.name)).toEqual([
        "experimentalFeatures",
        "customEndpoints",
        "externalApiKey",
        "maxPageSize",
      ]);
    });

    it("should return field definitions with correct types", () => {
      const fields = getCustomFieldDefinitions();

      const experimental = fields.find(f => f.name === "experimentalFeatures");
      expect(experimental?.type).toBe("boolean");
      expect(experimental?.envVar).toBe("MY_EXPERIMENTAL_FEATURES");
      expect(experimental?.cliFlag).toBe("my-experimental-features");

      const endpoints = fields.find(f => f.name === "customEndpoints");
      expect(endpoints?.type).toBe("csv");

      const apiKey = fields.find(f => f.name === "externalApiKey");
      expect(apiKey?.type).toBe("string");
    });

    it("should return a copy to prevent mutation", () => {
      const fields1 = getCustomFieldDefinitions();
      const fields2 = getCustomFieldDefinitions();

      expect(fields1).not.toBe(fields2);
      expect(fields1).toEqual(fields2);
    });
  });
});
