/**
 * Init module mock-fs tests.
 *
 * Tests removal functions and detectFeatures against an in-memory filesystem
 * populated from the real template fixture.
 */

import { jest } from "@jest/globals";
import * as path from "node:path";
import { createMockFs } from "../../__tests__/helpers/mock-fs.js";
import { loadScaffoldedFixture } from "../../__tests__/helpers/template-fixture.js";

const PROJECT_DIR = "/test-project";
const PROJECT_NAME = "test-mcp-server";

const mockFs = createMockFs(loadScaffoldedFixture(PROJECT_DIR, PROJECT_NAME));
jest.unstable_mockModule("node:fs", () => mockFs.module);

const { removeMocks } = await import("../remove-mocks.js");
const { removeExamples } = await import("../remove-examples.js");
const { removeChaining } = await import("../remove-chaining.js");
const { removeEvals } = await import("../remove-evals.js");
const { detectFeatures } = await import("../detect-features.js");

beforeEach(() => {
  mockFs.reset();
});

// ── detectFeatures ──────────────────────────────────────────────────────────

describe("detectFeatures", () => {
  it("should detect a valid scaffolded project", () => {
    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(true);
    expect(result.projectName).toBe(PROJECT_NAME);
    expect(result.projectDir).toBe(path.resolve(PROJECT_DIR));
  });

  it("should detect all features in a fresh scaffold", () => {
    const result = detectFeatures(PROJECT_DIR);
    expect(result.features).toEqual({
      hasMocks: true,
      hasChaining: true,
      hasExamples: true,
      hasEvals: true,
    });
  });

  it("should report invalid for a non-project directory", () => {
    const result = detectFeatures("/nonexistent");
    expect(result.valid).toBe(false);
    expect(result.missing).toBeDefined();
  });

  it("should detect missing features after removals", () => {
    removeMocks(PROJECT_DIR);
    removeChaining(PROJECT_DIR);

    const result = detectFeatures(PROJECT_DIR);
    expect(result.features!.hasMocks).toBe(false);
    expect(result.features!.hasChaining).toBe(false);
    expect(result.features!.hasExamples).toBe(true);
    expect(result.features!.hasEvals).toBe(true);
  });
});

// ── removeMocks ─────────────────────────────────────────────────────────────

describe("removeMocks", () => {
  it("should remove mocks directory", () => {
    expect(mockFs.files.has(path.resolve(PROJECT_DIR, "src/mocks/server.ts"))).toBe(true);

    removeMocks(PROJECT_DIR);

    // All src/mocks/ files should be gone
    const remaining = [...mockFs.files.keys()].filter((k) =>
      k.includes("/src/mocks/")
    );
    expect(remaining).toHaveLength(0);
  });

  it("should update jest.config.ts to remove setupFilesAfterEnv", () => {
    removeMocks(PROJECT_DIR);

    const jestConfig = mockFs.files.get(
      path.resolve(PROJECT_DIR, "jest.config.ts")
    )!;
    expect(jestConfig).not.toContain("setupFilesAfterEnv");
  });

  it("should remove msw from package.json", () => {
    removeMocks(PROJECT_DIR);

    const pkg = JSON.parse(
      mockFs.files.get(path.resolve(PROJECT_DIR, "package.json"))!
    );
    expect(pkg.devDependencies?.msw).toBeUndefined();
  });

  it("should be idempotent", () => {
    removeMocks(PROJECT_DIR);
    const changes = removeMocks(PROJECT_DIR);
    expect(changes).toBe(0);
  });
});

// ── removeExamples ──────────────────────────────────────────────────────────

describe("removeExamples", () => {
  it("should remove example tool directories", () => {
    removeExamples(PROJECT_DIR);

    const remaining = [...mockFs.files.keys()].filter(
      (k) =>
        k.includes("/tools/example/") || k.includes("/tools/example-2/")
    );
    expect(remaining).toHaveLength(0);
  });

  it("should update index.ts imports", () => {
    removeExamples(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;
    expect(indexTs).not.toContain("exampleCollection");
    expect(indexTs).not.toContain("example2Collection");
    // Chaining should still be there
    expect(indexTs).toContain("chainedCollection");
  });

  it("should update mode-registry.ts", () => {
    removeExamples(PROJECT_DIR);

    const modeRegistry = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/config/mode-registry.ts")
    )!;
    expect(modeRegistry).not.toContain("name: 'example'");
    expect(modeRegistry).not.toContain("name: 'example-2'");
    expect(modeRegistry).not.toContain("name: 'all-examples'");
  });

  it("should be idempotent", () => {
    removeExamples(PROJECT_DIR);
    const changes = removeExamples(PROJECT_DIR);
    expect(changes).toBe(0);
  });

  it("should snapshot index.ts after removal", () => {
    removeExamples(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;
    expect(indexTs).toMatchSnapshot();
  });
});

// ── removeChaining ──────────────────────────────────────────────────────────

describe("removeChaining", () => {
  it("should remove chaining-related files", () => {
    removeChaining(PROJECT_DIR);

    expect(
      mockFs.files.has(path.resolve(PROJECT_DIR, "src/config/mcp-servers.ts"))
    ).toBe(false);
    expect(
      mockFs.files.has(path.resolve(PROJECT_DIR, "src/umbraco-api/mcp-client.ts"))
    ).toBe(false);

    const chainedFiles = [...mockFs.files.keys()].filter((k) =>
      k.includes("/tools/chained/")
    );
    expect(chainedFiles).toHaveLength(0);
  });

  it("should update index.ts to remove chaining code", () => {
    removeChaining(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;
    expect(indexTs).not.toContain("mcpClientManager");
    expect(indexTs).not.toContain("mcpServers");
    expect(indexTs).not.toContain("chainedCollection");
    expect(indexTs).not.toContain("discoverProxiedTools");
  });

  it("should simplify process shutdown handlers", () => {
    removeChaining(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;
    expect(indexTs).toContain(
      'process.on("SIGINT", () => process.exit(0))'
    );
    expect(indexTs).not.toContain("mcpClientManager.disconnectAll");
  });

  it("should be idempotent", () => {
    removeChaining(PROJECT_DIR);
    const changes = removeChaining(PROJECT_DIR);
    expect(changes).toBe(0);
  });

  it("should snapshot index.ts after removal", () => {
    removeChaining(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;
    expect(indexTs).toMatchSnapshot();
  });
});

// ── removeEvals ─────────────────────────────────────────────────────────────

describe("removeEvals", () => {
  it("should remove tests/evals directory", () => {
    removeEvals(PROJECT_DIR);

    const remaining = [...mockFs.files.keys()].filter((k) =>
      k.includes("tests/evals")
    );
    expect(remaining).toHaveLength(0);
  });

  it("should update package.json scripts", () => {
    removeEvals(PROJECT_DIR);

    const pkg = JSON.parse(
      mockFs.files.get(path.resolve(PROJECT_DIR, "package.json"))!
    );
    expect(pkg.scripts?.["test:evals"]).toBeUndefined();
  });

  it("should be idempotent", () => {
    removeEvals(PROJECT_DIR);
    const changes = removeEvals(PROJECT_DIR);
    expect(changes).toBe(0);
  });
});

// ── Combined removals ───────────────────────────────────────────────────────

describe("combined removals", () => {
  it("should handle removing all features", () => {
    removeExamples(PROJECT_DIR);
    removeChaining(PROJECT_DIR);
    removeMocks(PROJECT_DIR);
    removeEvals(PROJECT_DIR);

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(true);
    expect(result.features).toEqual({
      hasMocks: false,
      hasChaining: false,
      hasExamples: false,
      hasEvals: false,
    });
  });

  it("should snapshot index.ts after examples + chaining removal", () => {
    removeExamples(PROJECT_DIR);
    removeChaining(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;
    expect(indexTs).toMatchSnapshot();
  });

  it("should produce valid index.ts when chaining removed before examples", () => {
    // Reverse order: chaining first, then examples
    removeChaining(PROJECT_DIR);
    removeExamples(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;

    // Should not contain any of the removed imports/references
    expect(indexTs).not.toContain("mcpClientManager");
    expect(indexTs).not.toContain("exampleCollection");
    expect(indexTs).not.toContain("example2Collection");
    expect(indexTs).not.toContain("chainedCollection");

    // Should still have core structure
    expect(indexTs).toContain("const server = new McpServer");
    expect(indexTs).toContain("main().catch");
  });

  it("should snapshot index.ts after chaining-first removal order", () => {
    removeChaining(PROJECT_DIR);
    removeExamples(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;
    expect(indexTs).toMatchSnapshot();
  });

  it("should produce identical result regardless of removal order", () => {
    // Order A: examples → chaining
    removeExamples(PROJECT_DIR);
    removeChaining(PROJECT_DIR);
    const indexTsA = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;

    // Reset and do order B: chaining → examples
    mockFs.reset();
    removeChaining(PROJECT_DIR);
    removeExamples(PROJECT_DIR);
    const indexTsB = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;

    expect(indexTsA).toBe(indexTsB);
  });

  it("should handle all four removals in any order", () => {
    removeMocks(PROJECT_DIR);
    removeEvals(PROJECT_DIR);
    removeChaining(PROJECT_DIR);
    removeExamples(PROJECT_DIR);

    const indexTs = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/index.ts")
    )!;

    // Core server structure must survive
    expect(indexTs).toContain("const server = new McpServer");
    expect(indexTs).toContain("main().catch");
    expect(indexTs).toContain("process.on(\"SIGINT\"");
    expect(indexTs).toContain("process.on(\"SIGTERM\"");

    // Nothing removed should remain
    expect(indexTs).not.toContain("mcpClientManager");
    expect(indexTs).not.toContain("exampleCollection");
    expect(indexTs).not.toContain("chainedCollection");
  });
});

// ── detectFeatures validation edge cases ─────────────────────────────────────

describe("detectFeatures validation", () => {
  it("should reject project missing orval.config.ts", () => {
    mockFs.files.delete(path.resolve(PROJECT_DIR, "orval.config.ts"));

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("orval.config.ts");
  });

  it("should reject project missing src/index.ts", () => {
    mockFs.files.delete(path.resolve(PROJECT_DIR, "src/index.ts"));

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("src/index.ts");
  });

  it("should reject project missing package.json", () => {
    mockFs.files.delete(path.resolve(PROJECT_DIR, "package.json"));

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("package.json");
  });

  it("should reject corrupt package.json", () => {
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "package.json"),
      "{broken json!!"
    );

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("valid package.json");
  });

  it("should reject package.json without SDK dependency", () => {
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "package.json"),
      JSON.stringify({ name: "test", dependencies: {} })
    );

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("@umbraco-cms/mcp-server-sdk dependency");
  });

  it("should accept SDK in devDependencies", () => {
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {},
        devDependencies: { "@umbraco-cms/mcp-server-sdk": "^17.0.0" },
      })
    );

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(true);
  });

  it("should report multiple missing files", () => {
    mockFs.files.delete(path.resolve(PROJECT_DIR, "package.json"));
    mockFs.files.delete(path.resolve(PROJECT_DIR, "src/index.ts"));
    mockFs.files.delete(path.resolve(PROJECT_DIR, "orval.config.ts"));

    const result = detectFeatures(PROJECT_DIR);
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(3);
  });
});
