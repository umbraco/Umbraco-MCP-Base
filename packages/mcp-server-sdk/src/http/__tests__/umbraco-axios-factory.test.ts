/**
 * Umbraco Axios Factory Tests
 *
 * Tests for createUmbracoAxiosClient factory:
 * - Creates independent client instances
 * - Each instance has its own state
 * - Supports custom options
 */

import { describe, it, expect } from "@jest/globals";
import { createUmbracoAxiosClient } from "../umbraco-axios-factory.js";
import { setupTestEnvironment } from "../../testing/test-environment.js";

describe("Umbraco Axios Factory", () => {
  setupTestEnvironment();

  describe("createUmbracoAxiosClient", () => {
    it("should create a client result object", () => {
      const result = createUmbracoAxiosClient();

      expect(result).toBeDefined();
      expect(result.client).toBeDefined();
      expect(typeof result.initialize).toBe("function");
      expect(typeof result.isInitialized).toBe("function");
      expect(typeof result.clearToken).toBe("function");
      expect(typeof result.mutator).toBe("function");
    });

    it("should create independent instances", () => {
      const instance1 = createUmbracoAxiosClient();
      const instance2 = createUmbracoAxiosClient();

      expect(instance1.client).not.toBe(instance2.client);
      expect(instance1.initialize).not.toBe(instance2.initialize);
    });

    it("should have independent initialization state", () => {
      const instance1 = createUmbracoAxiosClient();
      const instance2 = createUmbracoAxiosClient();

      instance1.initialize({
        baseUrl: "http://localhost:44391",
        clientId: "client-1",
        clientSecret: "secret-1",
      });

      expect(instance1.isInitialized()).toBe(true);
      expect(instance2.isInitialized()).toBe(false);
    });
  });

  describe("initialize", () => {
    it("should throw if baseUrl is missing", () => {
      const { initialize } = createUmbracoAxiosClient();

      expect(() =>
        initialize({
          baseUrl: "",
          clientId: "test-client",
          clientSecret: "test-secret",
        })
      ).toThrow("Missing required configuration: baseUrl");
    });

    it("should throw if clientId is missing", () => {
      const { initialize } = createUmbracoAxiosClient();

      expect(() =>
        initialize({
          baseUrl: "http://localhost:44391",
          clientId: "",
          clientSecret: "test-secret",
        })
      ).toThrow("Missing required configuration: clientId");
    });

    it("should throw if clientSecret is missing for non-swagger client", () => {
      const { initialize } = createUmbracoAxiosClient();

      expect(() =>
        initialize({
          baseUrl: "http://localhost:44391",
          clientId: "my-client",
        })
      ).toThrow("Missing required configuration: clientSecret");
    });

    it("should allow missing clientSecret for umbraco-swagger client", () => {
      const { initialize } = createUmbracoAxiosClient();

      expect(() =>
        initialize({
          baseUrl: "http://localhost:44391",
          clientId: "umbraco-swagger",
        })
      ).not.toThrow();
    });

    it("should set baseURL on the client", () => {
      const { client, initialize } = createUmbracoAxiosClient();

      initialize({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      expect(client.defaults.baseURL).toBe("http://localhost:44391");
    });
  });

  describe("isInitialized", () => {
    it("should return false before initialization", () => {
      const { isInitialized } = createUmbracoAxiosClient();

      expect(isInitialized()).toBe(false);
    });

    it("should return true after initialization", () => {
      const { initialize, isInitialized } = createUmbracoAxiosClient();

      initialize({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      expect(isInitialized()).toBe(true);
    });
  });

  describe("clearToken", () => {
    it("should not throw when called before initialization", () => {
      const { clearToken } = createUmbracoAxiosClient();

      expect(() => clearToken()).not.toThrow();
    });

    it("should not throw when called after initialization", () => {
      const { initialize, clearToken } = createUmbracoAxiosClient();

      initialize({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      expect(() => clearToken()).not.toThrow();
    });
  });

  describe("client", () => {
    it("should be an Axios instance", () => {
      const { client } = createUmbracoAxiosClient();

      expect(client).toBeDefined();
      expect(typeof client.get).toBe("function");
      expect(typeof client.post).toBe("function");
      expect(typeof client.put).toBe("function");
      expect(typeof client.delete).toBe("function");
    });

    it("should have paramsSerializer configured", () => {
      const { client } = createUmbracoAxiosClient();

      const serializer = client.defaults.paramsSerializer;
      expect(serializer).toBeDefined();

      if (typeof serializer === "function") {
        const result = serializer({ ids: ["a", "b", "c"] });
        expect(result).toBe("ids=a&ids=b&ids=c");
      }
    });
  });

  describe("mutator", () => {
    it("should be a function", () => {
      const { mutator } = createUmbracoAxiosClient();

      expect(typeof mutator).toBe("function");
    });

    it("should return a promise with cancel method", async () => {
      const { initialize, mutator } = createUmbracoAxiosClient();

      initialize({
        baseUrl: "http://localhost:44391",
        clientId: "test-client",
        clientSecret: "test-secret",
      });

      const promise = mutator({
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

  describe("options", () => {
    it("should accept custom tokenPath option", () => {
      const result = createUmbracoAxiosClient({
        tokenPath: "/custom/token/path",
      });

      expect(result).toBeDefined();
    });

    it("should accept rejectUnauthorized option", () => {
      const result = createUmbracoAxiosClient({
        rejectUnauthorized: true,
      });

      expect(result).toBeDefined();
    });

    it("should accept enableLogging option", () => {
      const result = createUmbracoAxiosClient({
        enableLogging: true,
      });

      expect(result).toBeDefined();
    });

    it("should accept all options together", () => {
      const result = createUmbracoAxiosClient({
        tokenPath: "/custom/token",
        rejectUnauthorized: false,
        enableLogging: true,
      });

      expect(result).toBeDefined();
      expect(result.client).toBeDefined();
    });
  });
});
