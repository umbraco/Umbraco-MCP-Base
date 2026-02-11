/**
 * Tests for init module functions.
 *
 * Each test uses a freshly scaffolded project to ensure isolation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { detectFeatures } from "../detect-features.js";
import { configureOpenApi } from "../configure-openapi.js";
import { removeMocks } from "../remove-mocks.js";
import { removeExamples } from "../remove-examples.js";
import { removeChaining } from "../remove-chaining.js";
import { removeEvals } from "../remove-evals.js";
import { verifyProject } from "../verify.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// __dirname = packages/create-mcp-server/src/init/__tests__
// Go up 5 levels to reach monorepo root
const ROOT_DIR = path.resolve(__dirname, "../../../../..");
const CREATE_SCRIPT = path.join(
  ROOT_DIR,
  "packages/create-mcp-server/dist/index.js"
);

const TEST_TIMEOUT = 30_000;

function createTestProject(name: string): string {
  const projectPath = path.join(ROOT_DIR, name);
  if (fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
  execSync(`node ${CREATE_SCRIPT} ${name}`, {
    cwd: ROOT_DIR,
    stdio: "pipe",
  });
  return projectPath;
}

function cleanupTestProject(projectPath: string): void {
  if (fs.existsSync(projectPath) && projectPath.includes("test-init-")) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
}

function readProjectFile(projectPath: string, relativePath: string): string {
  return fs.readFileSync(path.join(projectPath, relativePath), "utf-8");
}

function projectPathExists(
  projectPath: string,
  relativePath: string
): boolean {
  return fs.existsSync(path.join(projectPath, relativePath));
}

describe("detectFeatures", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-detect");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should detect a valid scaffolded project", () => {
    const result = detectFeatures(projectPath);

    expect(result.valid).toBe(true);
    expect(result.projectName).toBeDefined();
    expect(result.projectDir).toBe(projectPath);
  });

  it("should detect all features in a fresh scaffold", () => {
    const result = detectFeatures(projectPath);

    expect(result.features).toBeDefined();
    expect(result.features!.hasMocks).toBe(true);
    expect(result.features!.hasChaining).toBe(true);
    expect(result.features!.hasExamples).toBe(true);
    expect(result.features!.hasEvals).toBe(true);
  });

  it("should report invalid for a non-project directory", () => {
    const result = detectFeatures("/tmp");

    expect(result.valid).toBe(false);
    expect(result.missing).toBeDefined();
  });
});

describe("verifyProject", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-verify");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should validate a freshly scaffolded project", () => {
    const result = verifyProject(projectPath);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("should find tool collections", () => {
    const result = verifyProject(projectPath);

    expect(result.toolCollections.length).toBeGreaterThan(0);
    expect(result.toolCollections).toContain("example");
    expect(result.toolCollections).toContain("chained");
  });
});

describe("removeMocks", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-mocks");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should remove mocks directory", () => {
    expect(projectPathExists(projectPath, "src/mocks")).toBe(true);

    removeMocks(projectPath);

    expect(projectPathExists(projectPath, "src/mocks")).toBe(false);
  });

  it("should update jest.config.ts", () => {
    const jestConfig = readProjectFile(projectPath, "jest.config.ts");
    expect(jestConfig).not.toContain("setupFilesAfterEnv");
  });

  it("should remove msw from package.json", () => {
    const packageJson = JSON.parse(
      readProjectFile(projectPath, "package.json")
    );
    expect(packageJson.devDependencies?.msw).toBeUndefined();
  });

  it("should be idempotent", () => {
    const changes = removeMocks(projectPath);
    expect(changes).toBe(0);
  });
});

describe("removeExamples", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-examples");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should remove example tool directories", () => {
    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/example")
    ).toBe(true);
    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/example-2")
    ).toBe(true);

    removeExamples(projectPath);

    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/example")
    ).toBe(false);
    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/example-2")
    ).toBe(false);
  });

  it("should update index.ts imports", () => {
    const indexTs = readProjectFile(projectPath, "src/index.ts");

    expect(indexTs).not.toContain("exampleCollection");
    expect(indexTs).not.toContain("example2Collection");
    expect(indexTs).toContain("chainedCollection");
  });

  it("should update mode-registry.ts", () => {
    const modeRegistry = readProjectFile(
      projectPath,
      "src/config/mode-registry.ts"
    );

    expect(modeRegistry).not.toContain("name: 'example'");
    expect(modeRegistry).not.toContain("name: 'example-2'");
    expect(modeRegistry).not.toContain("name: 'all-examples'");
  });

  it("should be idempotent", () => {
    const changes = removeExamples(projectPath);
    expect(changes).toBe(0);
  });
});

describe("removeChaining", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-chaining");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should remove chaining-related files", () => {
    expect(
      projectPathExists(projectPath, "src/config/mcp-servers.ts")
    ).toBe(true);
    expect(
      projectPathExists(projectPath, "src/umbraco-api/mcp-client.ts")
    ).toBe(true);
    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/chained")
    ).toBe(true);
    expect(
      projectPathExists(projectPath, "src/testing/mock-mcp-server.ts")
    ).toBe(true);

    removeChaining(projectPath);

    expect(
      projectPathExists(projectPath, "src/config/mcp-servers.ts")
    ).toBe(false);
    expect(
      projectPathExists(projectPath, "src/umbraco-api/mcp-client.ts")
    ).toBe(false);
    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/chained")
    ).toBe(false);
    expect(
      projectPathExists(projectPath, "src/testing/mock-mcp-server.ts")
    ).toBe(false);
  });

  it("should update index.ts to remove chaining imports and code", () => {
    const indexTs = readProjectFile(projectPath, "src/index.ts");

    expect(indexTs).not.toContain("mcpClientManager");
    expect(indexTs).not.toContain("mcpServers");
    expect(indexTs).not.toContain("chainedCollection");
    expect(indexTs).not.toContain("discoverProxiedTools");
    expect(indexTs).not.toContain("parseProxiedToolName");
    expect(indexTs).not.toContain("CallToolResult");
  });

  it("should simplify process shutdown handlers", () => {
    const indexTs = readProjectFile(projectPath, "src/index.ts");

    expect(indexTs).toContain(
      'process.on("SIGINT", () => process.exit(0))'
    );
    expect(indexTs).not.toContain("mcpClientManager.disconnectAll");
  });

  it("should be idempotent", () => {
    const changes = removeChaining(projectPath);
    expect(changes).toBe(0);
  });
});

describe("removeEvals", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-evals");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should remove __evals__ directories", () => {
    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/__evals__")
    ).toBe(true);

    removeEvals(projectPath);

    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/__evals__")
    ).toBe(false);
  });

  it("should update package.json scripts", () => {
    const packageJson = JSON.parse(
      readProjectFile(projectPath, "package.json")
    );
    expect(packageJson.scripts?.["test:evals"]).toBeUndefined();
  });

  it("should update jest.config.ts testMatch", () => {
    const jestConfig = readProjectFile(projectPath, "jest.config.ts");
    expect(jestConfig).not.toContain("__evals__");
  });

  it("should be idempotent", () => {
    const changes = removeEvals(projectPath);
    expect(changes).toBe(0);
  });
});

describe("configureOpenApi", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-openapi");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should update orval.config.ts with new URL", () => {
    const testUrl =
      "https://localhost:44391/umbraco/swagger/commerce/swagger.json";

    configureOpenApi(projectPath, testUrl);

    const orvalConfig = readProjectFile(projectPath, "orval.config.ts");

    expect(orvalConfig).toContain(testUrl);
    expect(orvalConfig).not.toMatch(
      /target:\s*["']\.\/src\/api\/openapi\.yaml["']/
    );
  });

  it("should update both config sections", () => {
    const orvalConfig = readProjectFile(projectPath, "orval.config.ts");
    const testUrl =
      "https://localhost:44391/umbraco/swagger/commerce/swagger.json";

    const matches = orvalConfig.match(new RegExp(testUrl, "g"));
    expect(matches?.length).toBe(2);
  });

  it("should throw on invalid URLs", () => {
    expect(() => {
      configureOpenApi(projectPath, "not-a-valid-url");
    }).toThrow("Invalid URL format");
  });
});

describe("combined workflow", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-init-combined");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should support a typical setup workflow", () => {
    // 1. Remove examples
    removeExamples(projectPath);

    // 2. Configure OpenAPI
    configureOpenApi(
      projectPath,
      "https://localhost:44331/umbraco/swagger/commerce/swagger.json"
    );

    // 3. Remove evals
    removeEvals(projectPath);

    // 4. Verify the result
    const result = verifyProject(projectPath);
    expect(result.valid).toBe(true);

    // 5. Check that chaining and mocks are still present
    expect(
      projectPathExists(projectPath, "src/config/mcp-servers.ts")
    ).toBe(true);
    expect(projectPathExists(projectPath, "src/mocks")).toBe(true);

    // 6. Check that examples are gone
    expect(
      projectPathExists(projectPath, "src/umbraco-api/tools/example")
    ).toBe(false);

    // 7. Check that the index.ts has no dangling references
    const indexTs = readProjectFile(projectPath, "src/index.ts");
    expect(indexTs).toContain("chainedCollection");
    expect(indexTs).not.toContain("exampleCollection");
  });
});
