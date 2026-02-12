/**
 * Discover command black-box tests.
 *
 * Mocks all edges (fs, prompts, fetch, child_process) to test runDiscover orchestrator.
 */

import { jest } from "@jest/globals";
import * as path from "node:path";
import { createMockFs } from "../../__tests__/helpers/mock-fs.js";
import { createMockFetch } from "../../__tests__/helpers/mock-fetch.js";
import { loadScaffoldedFixture } from "../../__tests__/helpers/template-fixture.js";

const PROJECT_DIR = "/test-project";
const PROJECT_NAME = "test-mcp-server";

// ── Set up mocks ────────────────────────────────────────────────────────────

const mockFs = createMockFs(loadScaffoldedFixture(PROJECT_DIR, PROJECT_NAME));
jest.unstable_mockModule("node:fs", () => mockFs.module);

const mockExecSync = jest.fn();
jest.unstable_mockModule("node:child_process", () => ({
  execSync: mockExecSync,
  default: { execSync: mockExecSync },
}));

// Mock prompts
const mockPromptBaseUrl = jest.fn<() => Promise<string>>();
const mockPromptApiSelection = jest.fn<() => Promise<{ url: string; name: string }>>();
const mockPromptConfirmOrval = jest.fn<() => Promise<boolean>>();
const mockPromptConfirmGenerate = jest.fn<() => Promise<boolean>>();
const mockPromptGroupSelection = jest.fn<(groups: unknown[]) => Promise<unknown[]>>();
const mockPromptUpdateModeRegistry = jest.fn<() => Promise<boolean>>();
const mockPromptUpdateSliceRegistry = jest.fn<() => Promise<boolean>>();

jest.unstable_mockModule("../prompts.js", () => ({
  promptBaseUrl: mockPromptBaseUrl,
  promptApiSelection: mockPromptApiSelection,
  promptConfirmOrval: mockPromptConfirmOrval,
  promptConfirmGenerate: mockPromptConfirmGenerate,
  promptGroupSelection: mockPromptGroupSelection,
  promptUpdateModeRegistry: mockPromptUpdateModeRegistry,
  promptUpdateSliceRegistry: mockPromptUpdateSliceRegistry,
}));

// Mock check-api-user (network-dependent)
jest.unstable_mockModule("../check-api-user.js", () => ({
  checkApiUser: jest.fn<() => Promise<{ authenticated: boolean }>>().mockResolvedValue({ authenticated: true }),
  printApiUserWarning: jest.fn(),
}));

const { runDiscover } = await import("../index.js");

let consoleLogSpy: ReturnType<typeof jest.spyOn>;
let processExitSpy: ReturnType<typeof jest.spyOn>;
let originalFetch: typeof globalThis.fetch;

// Sample swagger spec
const sampleSpec = {
  info: { title: "Commerce API" },
  paths: {
    "/api/products": {
      get: {
        tags: ["product"],
        operationId: "list-products",
        summary: "List products",
      },
      post: {
        tags: ["product"],
        operationId: "create-product",
        summary: "Create product",
      },
    },
    "/api/products/{id}": {
      get: {
        tags: ["product"],
        operationId: "get-product",
        summary: "Get product",
      },
    },
    "/api/orders": {
      get: {
        tags: ["order"],
        operationId: "list-orders",
        summary: "List orders",
      },
    },
  },
};

const BASE_URL = "https://localhost:44391";

function setupStandardFetch() {
  const swaggerUiHtml = `<script>var configObject = JSON.parse('{"urls":[{"url":"commerce/swagger.json","name":"Commerce API"}]}');</script>`;

  // Order matters: more specific patterns first (mock-fetch matches first hit)
  globalThis.fetch = createMockFetch([
    { pattern: "commerce/swagger.json", body: sampleSpec },
    { pattern: "/umbraco/swagger/index.js", body: swaggerUiHtml },
    { pattern: "/umbraco/swagger/", body: swaggerUiHtml },
  ]);
}

beforeEach(() => {
  mockFs.reset();
  jest.clearAllMocks();
  originalFetch = globalThis.fetch;
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  processExitSpy = jest
    .spyOn(process, "exit")
    .mockImplementation((code?: number | string | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    }) as unknown as ReturnType<typeof jest.spyOn>;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("runDiscover", () => {
  describe("invalid project", () => {
    it("should exit(1) for non-project directory", async () => {
      await expect(runDiscover("/nonexistent")).rejects.toThrow(
        "process.exit(1)"
      );
    });
  });

  describe("health check fails", () => {
    it("should exit(1) when instance is unreachable", async () => {
      mockPromptBaseUrl.mockResolvedValue(BASE_URL);

      // Fetch returns 500 for swagger UI
      globalThis.fetch = createMockFetch([
        { pattern: "/umbraco/swagger/", status: 500, body: "Error" },
        { pattern: "/umbraco/swagger/index.js", status: 500, body: "Error" },
        { pattern: "/umbraco/swagger/index.html", status: 500, body: "Error" },
        // Fallback probes for known API names
        { pattern: "management/swagger.json", status: 404, body: "" },
        { pattern: "delivery/swagger.json", status: 404, body: "" },
        { pattern: "commerce/swagger.json", status: 404, body: "" },
        { pattern: "forms/swagger.json", status: 404, body: "" },
        { pattern: "deploy/swagger.json", status: 404, body: "" },
        { pattern: "workflow/swagger.json", status: 404, body: "" },
      ]);

      await expect(runDiscover(PROJECT_DIR)).rejects.toThrow(
        "process.exit(1)"
      );

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Could not reach");
    });
  });

  describe("no swagger endpoints", () => {
    it("should exit(1) when no endpoints found", async () => {
      mockPromptBaseUrl.mockResolvedValue(BASE_URL);

      // Health check passes, but no swagger endpoints
      // Order matters: specific swagger.json patterns MUST come before broad
      // "/umbraco/swagger/" to avoid the broad pattern matching fallback probe URLs
      globalThis.fetch = createMockFetch([
        // Fallback probes all fail (specific patterns first)
        { pattern: "management/swagger.json", status: 404, body: "" },
        { pattern: "delivery/swagger.json", status: 404, body: "" },
        { pattern: "commerce/swagger.json", status: 404, body: "" },
        { pattern: "forms/swagger.json", status: 404, body: "" },
        { pattern: "deploy/swagger.json", status: 404, body: "" },
        { pattern: "workflow/swagger.json", status: 404, body: "" },
        // Swagger UI sources (broad patterns last)
        { pattern: "/umbraco/swagger/index.js", body: "// no config" },
        { pattern: "/umbraco/swagger/index.html", body: "<html></html>" },
        { pattern: "/umbraco/swagger/", body: "<html>No swagger</html>" },
      ]);

      await expect(runDiscover(PROJECT_DIR)).rejects.toThrow(
        "process.exit(1)"
      );

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("No Swagger endpoints");
    });
  });

  describe("happy path (single API)", () => {
    it("should discover, analyze, suggest modes, and write manifest", async () => {
      setupStandardFetch();
      mockPromptBaseUrl.mockResolvedValue(BASE_URL);
      mockPromptApiSelection.mockResolvedValue({
        url: `${BASE_URL}/umbraco/swagger/commerce/swagger.json`,
        name: "Commerce API",
      });
      mockPromptConfirmOrval.mockResolvedValue(false);
      mockPromptConfirmGenerate.mockResolvedValue(false);

      // User selects all groups
      mockPromptGroupSelection.mockImplementation(async (groups: unknown[]) => groups);

      // Skip mode/slice registry updates
      mockPromptUpdateModeRegistry.mockResolvedValue(false);

      // Claude CLI not available
      mockExecSync.mockImplementation(() => {
        throw new Error("claude not found");
      });

      await runDiscover(PROJECT_DIR);

      // Verify .discover.json was written
      const manifestPath = path.resolve(PROJECT_DIR, ".discover.json");
      expect(mockFs.files.has(manifestPath)).toBe(true);

      const manifest = JSON.parse(mockFs.files.get(manifestPath)!);
      expect(manifest.apiName).toBe("Commerce API");
      expect(manifest.baseUrl).toBe(BASE_URL);
      expect(manifest.collections).toContain("product");
      expect(manifest.collections).toContain("order");
    });
  });

  describe("no groups selected", () => {
    it("should return early without writing manifest", async () => {
      setupStandardFetch();
      mockPromptBaseUrl.mockResolvedValue(BASE_URL);
      mockPromptApiSelection.mockResolvedValue({
        url: `${BASE_URL}/umbraco/swagger/commerce/swagger.json`,
        name: "Commerce API",
      });
      mockPromptConfirmOrval.mockResolvedValue(false);
      mockPromptConfirmGenerate.mockResolvedValue(false);
      mockPromptGroupSelection.mockResolvedValue([]);

      await runDiscover(PROJECT_DIR);

      // Verify .discover.json was NOT written
      expect(
        mockFs.files.has(path.resolve(PROJECT_DIR, ".discover.json"))
      ).toBe(false);

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("No groups selected");
    });
  });

  describe("skip orval/generate", () => {
    it("should not update orval config when user declines", async () => {
      setupStandardFetch();
      mockPromptBaseUrl.mockResolvedValue(BASE_URL);
      mockPromptApiSelection.mockResolvedValue({
        url: `${BASE_URL}/umbraco/swagger/commerce/swagger.json`,
        name: "Commerce API",
      });
      mockPromptConfirmOrval.mockResolvedValue(false);
      mockPromptConfirmGenerate.mockResolvedValue(false);
      mockPromptGroupSelection.mockImplementation(async (groups: unknown[]) => groups);
      mockPromptUpdateModeRegistry.mockResolvedValue(false);

      mockExecSync.mockImplementation(() => {
        throw new Error("claude not found");
      });

      // Capture orval config before
      const orvalBefore = mockFs.files.get(
        path.resolve(PROJECT_DIR, "orval.config.ts")
      );

      await runDiscover(PROJECT_DIR);

      // Orval config should be unchanged
      const orvalAfter = mockFs.files.get(
        path.resolve(PROJECT_DIR, "orval.config.ts")
      );
      expect(orvalAfter).toBe(orvalBefore);
    });
  });

  describe("LLM modes", () => {
    it("should use fallback modes when Claude CLI is unavailable", async () => {
      setupStandardFetch();
      mockPromptBaseUrl.mockResolvedValue(BASE_URL);
      mockPromptApiSelection.mockResolvedValue({
        url: `${BASE_URL}/umbraco/swagger/commerce/swagger.json`,
        name: "Commerce API",
      });
      mockPromptConfirmOrval.mockResolvedValue(false);
      mockPromptConfirmGenerate.mockResolvedValue(false);
      mockPromptGroupSelection.mockImplementation(async (groups: unknown[]) => groups);
      mockPromptUpdateModeRegistry.mockResolvedValue(false);

      mockExecSync.mockImplementation(() => {
        throw new Error("claude not found");
      });

      await runDiscover(PROJECT_DIR);

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("fallback");
    });
  });
});
