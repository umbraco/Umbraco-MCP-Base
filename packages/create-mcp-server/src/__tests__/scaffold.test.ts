/**
 * Scaffold black-box tests.
 *
 * Mocks node:fs to test scaffoldProject() without touching the real filesystem.
 * Also tests toKebabCase() as a pure function.
 */

import { jest } from "@jest/globals";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockFs } from "./helpers/mock-fs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When running via ts-jest, __dirname in scaffold.ts resolves to the src/ directory.
// getTemplatePath() does path.resolve(__dirname, "template") → src/template
const TEMPLATE_DIR = path.resolve(__dirname, "../template");

function buildTemplateFsEntries(): Record<string, string> {
  const files: Record<string, string> = {};

  // Simulate the template directory with key files
  files[path.join(TEMPLATE_DIR, "package.json")] = JSON.stringify({
    name: "@umbraco-cms/mcp-template",
    version: "1.0.0",
    bin: { "my-umbraco-mcp": "dist/index.js" },
    description: "MCP server for my Umbraco add-on",
    dependencies: {
      "@umbraco-cms/mcp-server-sdk": "file:../packages/mcp-server-sdk",
    },
    devDependencies: { msw: "^2.12.7" },
  }, null, 2);

  files[path.join(TEMPLATE_DIR, "README.md")] =
    "# My Umbraco MCP Server\n\nTemplate readme content.\n";

  files[path.join(TEMPLATE_DIR, "src/index.ts")] =
    '#!/usr/bin/env node\nimport "dotenv/config";\n';

  files[path.join(TEMPLATE_DIR, "tsconfig.json")] = "{}";

  files[path.join(TEMPLATE_DIR, ".env")] = "UMBRACO_BASE_URL=https://localhost:44391\n";

  files[path.join(TEMPLATE_DIR, "node_modules/fake/index.js")] = "// should be excluded";

  files[path.join(TEMPLATE_DIR, "dist/index.js")] = "// should be excluded";

  // Also add the package.json for getDefaultSdkVersion
  // scaffold.ts does path.resolve(__dirname, "..", "package.json")
  // When __dirname is src/, ".." goes to the package root
  files[path.resolve(__dirname, "../../package.json")] = JSON.stringify({
    version: "17.0.0-beta.1",
  });

  return files;
}

const mockFs = createMockFs(buildTemplateFsEntries());

jest.unstable_mockModule("node:fs", () => mockFs.module);

// Must dynamically import after mocking
const { scaffoldProject, toKebabCase } = await import("../scaffold.js");

beforeEach(() => {
  mockFs.reset();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("toKebabCase", () => {
  it.each([
    ["MyProject", "my-project"],
    ["Umbraco-Commerce-Developer-MCP", "umbraco-commerce-developer-mcp"],
    ["camelCaseProject", "camel-case-project"],
    ["simple", "simple"],
    ["With_Underscores", "with-underscores"],
    ["ALLCAPS", "allcaps"],
  ])("converts %s to %s", (input, expected) => {
    expect(toKebabCase(input)).toBe(expected);
  });
});

describe("scaffoldProject", () => {
  const TARGET_DIR = "/test-output/my-project";

  it("should transform package.json with project name and SDK version", () => {
    scaffoldProject({
      projectName: "My-Commerce-MCP",
      targetDir: TARGET_DIR,
      sdkVersion: "^17.0.0",
    });

    const pkgPath = path.join(TARGET_DIR, "package.json");
    const pkg = JSON.parse(mockFs.files.get(pkgPath)!);

    expect(pkg.name).toBe("my-commerce-mcp");
    expect(pkg.bin).toEqual({ "my-commerce-mcp": "./dist/index.js" });
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.description).toBe("MCP server for My-Commerce-MCP");
    expect(pkg.dependencies["@umbraco-cms/mcp-server-sdk"]).toBe("^17.0.0");
  });

  it("should transform README title", () => {
    scaffoldProject({
      projectName: "My-Commerce-MCP",
      targetDir: TARGET_DIR,
      sdkVersion: "^17.0.0",
    });

    const readme = mockFs.files.get(path.join(TARGET_DIR, "README.md"))!;
    expect(readme).toContain("# My-Commerce-MCP");
    expect(readme).not.toContain("# My Umbraco MCP Server");
  });

  it("should exclude node_modules and dist directories", () => {
    scaffoldProject({
      projectName: "test",
      targetDir: TARGET_DIR,
      sdkVersion: "^17.0.0",
    });

    const writtenPaths = [...mockFs.writtenFiles.keys()];
    expect(writtenPaths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(writtenPaths.some((p) => p.includes("/dist/"))).toBe(false);
  });

  it("should exclude .env files", () => {
    scaffoldProject({
      projectName: "test",
      targetDir: TARGET_DIR,
      sdkVersion: "^17.0.0",
    });

    const writtenPaths = [...mockFs.writtenFiles.keys()];
    // .env should be excluded, but .env.example would not be (not in mock template here)
    expect(writtenPaths.some((p) => p.endsWith("/.env"))).toBe(false);
  });

  it("should copy non-transformed files as-is", () => {
    scaffoldProject({
      projectName: "test",
      targetDir: TARGET_DIR,
      sdkVersion: "^17.0.0",
    });

    const indexTs = mockFs.files.get(path.join(TARGET_DIR, "src/index.ts"))!;
    expect(indexTs).toBe('#!/usr/bin/env node\nimport "dotenv/config";\n');
  });

  it("should throw when template directory is missing", () => {
    // Clear all files to simulate missing template
    mockFs.files.clear();

    expect(() =>
      scaffoldProject({
        projectName: "test",
        targetDir: TARGET_DIR,
        sdkVersion: "^17.0.0",
      })
    ).toThrow("Template directory not found");
  });

  it("should snapshot transformed package.json", () => {
    scaffoldProject({
      projectName: "My-Commerce-MCP",
      targetDir: TARGET_DIR,
      sdkVersion: "^17.0.0",
    });

    const pkg = mockFs.files.get(path.join(TARGET_DIR, "package.json"))!;
    expect(pkg).toMatchSnapshot();
  });

  it("should use fallback SDK version when package.json is missing", () => {
    // Remove the package.json that getDefaultSdkVersion reads
    const pkgJsonPath = path.resolve(__dirname, "../../package.json");
    mockFs.files.delete(pkgJsonPath);

    scaffoldProject({
      projectName: "test",
      targetDir: TARGET_DIR,
      // No sdkVersion provided — triggers getDefaultSdkVersion()
    });

    const pkg = JSON.parse(mockFs.files.get(path.join(TARGET_DIR, "package.json"))!);
    expect(pkg.dependencies["@umbraco-cms/mcp-server-sdk"]).toBe("^17.0.0");
  });

  it("should use fallback SDK version when package.json is corrupt", () => {
    const pkgJsonPath = path.resolve(__dirname, "../../package.json");
    mockFs.files.set(pkgJsonPath, "NOT VALID JSON");

    scaffoldProject({
      projectName: "test",
      targetDir: TARGET_DIR,
    });

    const pkg = JSON.parse(mockFs.files.get(path.join(TARGET_DIR, "package.json"))!);
    expect(pkg.dependencies["@umbraco-cms/mcp-server-sdk"]).toBe("^17.0.0");
  });

  it("should derive SDK version from own package.json", () => {
    scaffoldProject({
      projectName: "test",
      targetDir: TARGET_DIR,
      // No sdkVersion — reads from package.json which has version "17.0.0-beta.1"
    });

    const pkg = JSON.parse(mockFs.files.get(path.join(TARGET_DIR, "package.json"))!);
    // getDefaultSdkVersion() returns pkg.version directly, not prefixed with ^
    expect(pkg.dependencies["@umbraco-cms/mcp-server-sdk"]).toBe("17.0.0-beta.1");
  });
});
