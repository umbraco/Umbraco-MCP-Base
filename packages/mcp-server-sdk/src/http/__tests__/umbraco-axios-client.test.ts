/**
 * Umbraco Axios Client Tests
 *
 * Tests for the singleton Axios client:
 * - initializeUmbracoAxios - Client initialization
 * - isUmbracoAxiosInitialized - Initialization check
 * - clearUmbracoAxiosToken - Token clearing
 * - UmbracoManagementClient - Orval mutator
 */

import { jest, describe, it, expect } from "@jest/globals";
import { setupTestEnvironment } from "../../testing/test-environment.js";

// Helper to reset modules and get fresh imports
async function getClientModule() {
  jest.resetModules();
  return await import("../umbraco-axios-client.js");
}

describe("Umbraco Axios Client", () => {
  setupTestEnvironment();

  describe("initializeUmbracoAxios", () => {
    it("should throw if baseUrl is missing", async () => {
      const { initializeUmbracoAxios } = await getClientModule();

      expect(() =>
        initializeUmbracoAxios({
          baseUrl: "",
          clientId: "test-client",
          clientSecret: "test-secret",
        })
      ).toThrow("Missing required configuration: baseUrl");
    });

    it("should throw if clientId is missing", async () => {
      const { initializeUmbracoAxios } = await getClientModule();

      expect(() =>
        initializeUmbracoAxios({
          baseUrl: "http://localhost:44391",
          clientId: "",
          clientSecret: "test-secret",
        })
      ).toThrow("Missing required configuration: clientId");
    });

    it("should throw if clientSecret is missing for non-swagger client", async () => {
      const { initializeUmbracoAxios } = await getClientModule();

      expect(() =>
        initializeUmbracoAxios({
          baseUrl: "http://localhost:44391",
          clientId: "my-client",
        })
      ).toThrow("Missing required configuration: clientSecret");
    });

    it("should allow missing clientSecret for umbraco-swagger client", async () => {
      const { initializeUmbracoAxios } = await getClientModule();

      expect(() =>
        initializeUmbracoAxios({
          baseUrl: "http://localhost:44391",
          clientId: "umbraco-swagger",
        })
      ).not.toThrow();
    });

    it("should initialize successfully with valid config", async () => {
      const { initializeUmbracoAxios, isUmbracoAxiosInitialized } =
        await getClientModule();

      initializeUmbracoAxios({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      expect(isUmbracoAxiosInitialized()).toBe(true);
    });
  });

  describe("isUmbracoAxiosInitialized", () => {
    it("should return false before initialization", async () => {
      const { isUmbracoAxiosInitialized } = await getClientModule();

      expect(isUmbracoAxiosInitialized()).toBe(false);
    });

    it("should return true after initialization", async () => {
      const { initializeUmbracoAxios, isUmbracoAxiosInitialized } =
        await getClientModule();

      initializeUmbracoAxios({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      expect(isUmbracoAxiosInitialized()).toBe(true);
    });
  });

  describe("clearUmbracoAxiosToken", () => {
    it("should not throw when called before initialization", async () => {
      const { clearUmbracoAxiosToken } = await getClientModule();

      expect(() => clearUmbracoAxiosToken()).not.toThrow();
    });

    it("should not throw when called after initialization", async () => {
      const { initializeUmbracoAxios, clearUmbracoAxiosToken } =
        await getClientModule();

      initializeUmbracoAxios({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      expect(() => clearUmbracoAxiosToken()).not.toThrow();
    });
  });

  describe("UmbracoAxios", () => {
    it("should be an Axios instance", async () => {
      const { UmbracoAxios } = await getClientModule();

      expect(UmbracoAxios).toBeDefined();
      expect(typeof UmbracoAxios.get).toBe("function");
      expect(typeof UmbracoAxios.post).toBe("function");
      expect(typeof UmbracoAxios.put).toBe("function");
      expect(typeof UmbracoAxios.delete).toBe("function");
    });

    it("should have paramsSerializer configured", async () => {
      const { UmbracoAxios } = await getClientModule();

      const serializer = UmbracoAxios.defaults.paramsSerializer;
      expect(serializer).toBeDefined();

      // Test array serialization (should use repeat format)
      if (typeof serializer === "function") {
        const result = serializer({ ids: ["a", "b", "c"] });
        expect(result).toBe("ids=a&ids=b&ids=c");
      }
    });
  });

  describe("UmbracoManagementClient", () => {
    it("should be a function", async () => {
      const { UmbracoManagementClient } = await getClientModule();

      expect(typeof UmbracoManagementClient).toBe("function");
    });

    it("should return a promise with cancel method", async () => {
      const { initializeUmbracoAxios, UmbracoManagementClient } =
        await getClientModule();

      initializeUmbracoAxios({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      const promise = UmbracoManagementClient({
        method: "GET",
        url: "/test",
      });

      expect(promise).toBeInstanceOf(Promise);
      expect(typeof (promise as any).cancel).toBe("function");

      // Cancel and catch to avoid unhandled rejection
      (promise as any).cancel();
      await promise.catch(() => {});
    });
  });

  describe("DEFAULT_TOKEN_PATH", () => {
    it("should export the default token path", async () => {
      const { DEFAULT_TOKEN_PATH } = await getClientModule();

      expect(DEFAULT_TOKEN_PATH).toBe(
        "/umbraco/management/api/v1/security/back-office/token"
      );
    });
  });
});
