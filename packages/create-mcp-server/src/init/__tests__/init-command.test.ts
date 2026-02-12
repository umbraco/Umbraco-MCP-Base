/**
 * Init command black-box tests.
 *
 * Mocks all edges (fs, prompts, child_process) to test runInit orchestrator.
 */

import { jest } from "@jest/globals";
import * as path from "node:path";
import { createMockFs } from "../../__tests__/helpers/mock-fs.js";
import { loadScaffoldedFixture } from "../../__tests__/helpers/template-fixture.js";

const PROJECT_DIR = "/test-project";
const PROJECT_NAME = "test-mcp-server";

// ── Set up mocks before importing the module under test ─────────────────────

const mockFs = createMockFs(loadScaffoldedFixture(PROJECT_DIR, PROJECT_NAME));
jest.unstable_mockModule("node:fs", () => mockFs.module);

// Mock child_process (used by setupInstance)
const mockExecSync = jest.fn();
jest.unstable_mockModule("node:child_process", () => ({
  execSync: mockExecSync,
  default: { execSync: mockExecSync },
}));

// Mock prompts — we control all user responses
let promptResponses: Record<string, unknown> = {};
const mockPromptUmbracoSetup = jest.fn<() => Promise<string>>();
const mockPromptFeatureChoices = jest.fn<() => Promise<Record<string, boolean>>>();
const mockPromptPackageSelection = jest.fn<() => Promise<string>>();
const mockGetInstanceLocation = jest.fn<() => { path: string; label: string }>();
const mockPromptSwaggerUrl = jest.fn<() => Promise<string>>();
const mockPromptDatabase = jest.fn<() => Promise<{ type: string }>>();

jest.unstable_mockModule("../prompts.js", () => ({
  promptUmbracoSetup: mockPromptUmbracoSetup,
  promptFeatureChoices: mockPromptFeatureChoices,
  promptPackageSelection: mockPromptPackageSelection,
  getInstanceLocation: mockGetInstanceLocation,
  promptSwaggerUrl: mockPromptSwaggerUrl,
  promptDatabase: mockPromptDatabase,
}));

// Mock discover/index.js exports used by init
const mockReadLaunchSettingsUrl = jest.fn<() => string | undefined>();
const mockUpdateEnvBaseUrl = jest.fn<() => boolean>();
const mockUpdateEnvVar = jest.fn<() => boolean>();

jest.unstable_mockModule("../../discover/index.js", () => ({
  readLaunchSettingsUrl: mockReadLaunchSettingsUrl,
  updateEnvBaseUrl: mockUpdateEnvBaseUrl,
  updateEnvVar: mockUpdateEnvVar,
}));

const { runInit } = await import("../index.js");

let consoleLogSpy: ReturnType<typeof jest.spyOn>;
let processExitSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockFs.reset();
  jest.clearAllMocks();
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  processExitSpy = jest
    .spyOn(process, "exit")
    .mockImplementation((code?: number | string | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    }) as unknown as ReturnType<typeof jest.spyOn>;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("runInit", () => {
  describe("invalid project", () => {
    it("should exit(1) for non-project directory", async () => {
      await expect(runInit("/nonexistent")).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("skip Umbraco + remove all features", () => {
    it("should remove all features when user chooses remove for each", async () => {
      mockPromptUmbracoSetup.mockResolvedValue("skip");
      mockPromptFeatureChoices.mockResolvedValue({
        removeMocks: true,
        removeChaining: true,
        removeExamples: true,
        removeEvals: true,
      });

      await runInit(PROJECT_DIR);

      // Verify mocks directory was removed
      const mockFiles = [...mockFs.files.keys()].filter((k) =>
        k.includes("/src/mocks/")
      );
      expect(mockFiles).toHaveLength(0);

      // Verify chaining files were removed
      expect(
        mockFs.files.has(path.resolve(PROJECT_DIR, "src/config/mcp-servers.ts"))
      ).toBe(false);

      // Verify example directories were removed
      const exampleFiles = [...mockFs.files.keys()].filter(
        (k) =>
          k.includes("/tools/example/") || k.includes("/tools/example-2/")
      );
      expect(exampleFiles).toHaveLength(0);

      // Verify evals were removed
      const evalFiles = [...mockFs.files.keys()].filter((k) =>
        k.includes("__evals__")
      );
      expect(evalFiles).toHaveLength(0);

      // Verify summary was printed
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Configuration complete");
    });
  });

  describe("skip Umbraco + keep all features", () => {
    it("should not remove any features when user keeps all", async () => {
      mockPromptUmbracoSetup.mockResolvedValue("skip");
      mockPromptFeatureChoices.mockResolvedValue({
        removeMocks: false,
        removeChaining: false,
        removeExamples: false,
        removeEvals: false,
      });

      await runInit(PROJECT_DIR);

      // All files should still exist
      expect(
        mockFs.files.has(path.resolve(PROJECT_DIR, "src/mocks/server.ts"))
      ).toBe(true);
      expect(
        mockFs.files.has(path.resolve(PROJECT_DIR, "src/config/mcp-servers.ts"))
      ).toBe(true);
      expect(
        [...mockFs.files.keys()].some((k) => k.includes("/tools/example/"))
      ).toBe(true);
    });
  });

  describe("existing instance + swagger URL", () => {
    it("should configure OpenAPI with provided URL", async () => {
      const swaggerUrl =
        "https://localhost:44391/umbraco/swagger/commerce/swagger.json";

      mockPromptUmbracoSetup.mockResolvedValue("existing");
      mockPromptSwaggerUrl.mockResolvedValue(swaggerUrl);
      mockPromptFeatureChoices.mockResolvedValue({
        removeMocks: false,
        removeChaining: false,
        removeExamples: false,
        removeEvals: false,
      });

      await runInit(PROJECT_DIR);

      // Verify orval.config.ts was updated with the swagger URL
      const orvalConfig = mockFs.files.get(
        path.resolve(PROJECT_DIR, "orval.config.ts")
      )!;
      expect(orvalConfig).toContain(swaggerUrl);
    });
  });

  describe("create instance (happy path)", () => {
    it("should call setupInstance and update .env", async () => {
      mockPromptUmbracoSetup.mockResolvedValue("create");
      mockPromptPackageSelection.mockResolvedValue("Umbraco.Commerce");
      mockGetInstanceLocation.mockReturnValue({
        path: path.join(PROJECT_DIR, "demo-site"),
        label: "demo-site",
      });
      mockPromptDatabase.mockResolvedValue({ type: "localdb" });
      mockPromptFeatureChoices.mockResolvedValue({
        removeMocks: false,
        removeChaining: false,
        removeExamples: false,
        removeEvals: false,
      });

      // execSync is called by setupInstance — just don't throw
      mockExecSync.mockReturnValue("");

      // readLaunchSettingsUrl returns a detected URL
      mockReadLaunchSettingsUrl.mockReturnValue("https://localhost:44391");
      mockUpdateEnvBaseUrl.mockReturnValue(true);
      mockUpdateEnvVar.mockReturnValue(true);

      await runInit(PROJECT_DIR);

      // Verify setupInstance was invoked (via execSync for dotnet commands)
      expect(mockExecSync).toHaveBeenCalled();

      // Verify .env vars were set
      expect(mockUpdateEnvBaseUrl).toHaveBeenCalledWith(
        PROJECT_DIR,
        "https://localhost:44391"
      );
      expect(mockUpdateEnvVar).toHaveBeenCalledWith(
        PROJECT_DIR,
        "UMBRACO_CLIENT_ID",
        "umbraco-back-office-mcp"
      );

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Umbraco instance created");
    });
  });

  describe("create instance failure", () => {
    it("should handle error gracefully and continue to features", async () => {
      mockPromptUmbracoSetup.mockResolvedValue("create");
      mockPromptPackageSelection.mockResolvedValue("Umbraco.Commerce");
      mockGetInstanceLocation.mockReturnValue({
        path: path.join(PROJECT_DIR, "demo-site"),
        label: "demo-site",
      });
      mockPromptDatabase.mockResolvedValue({ type: "localdb" });
      mockPromptFeatureChoices.mockResolvedValue({
        removeMocks: false,
        removeChaining: false,
        removeExamples: false,
        removeEvals: false,
      });

      // Make execSync throw to simulate failure
      mockExecSync.mockImplementation(() => {
        throw new Error("dotnet not found");
      });

      await runInit(PROJECT_DIR);

      // Should have printed the error but continued
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Instance setup failed");
      expect(output).toContain("Configuration complete");
    });
  });
});
