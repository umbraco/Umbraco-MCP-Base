/**
 * Template fixture: in-memory representation of a scaffolded project.
 *
 * Contains only the files that the CLI actually reads/edits during init and discover.
 * Prefixed with a project path so mock-fs can simulate a real project directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the real dist/template directory
const TEMPLATE_DIR = path.resolve(__dirname, "../../../dist/template");

/**
 * Key template files that the CLI reads/edits.
 * These are the only files needed for mock-fs testing.
 */
const FIXTURE_FILES = [
  "package.json",
  "README.md",
  "jest.config.ts",
  "orval.config.ts",
  ".env.example",
  "src/index.ts",
  "src/config/index.ts",
  "src/config/mode-registry.ts",
  "src/config/slice-registry.ts",
  "src/config/mcp-servers.ts",
  "src/config/server-config.ts",
  "src/mocks/jest-setup.ts",
  "src/mocks/server.ts",
  "src/mocks/handlers.ts",
  "src/mocks/store.ts",
  "src/umbraco-api/mcp-client.ts",
  "src/umbraco-api/tools/example/index.ts",
  "src/umbraco-api/tools/example/get/get-example.ts",
  "src/umbraco-api/tools/example-2/index.ts",
  "src/umbraco-api/tools/chained/index.ts",
  "src/umbraco-api/tools/chained/get-chained-info.ts",
  "src/umbraco-api/tools/example/__evals__/example-crud.eval.ts",
  "src/umbraco-api/tools/example/__evals__/setup.ts",
  "src/umbraco-api/tools/__evals__/tool-filtering.eval.ts",
  "src/umbraco-api/tools/__evals__/mcp-chaining.eval.ts",
  "src/testing/mock-mcp-server.ts",
];

/**
 * Load template fixture files from disk.
 * Returns a Record<absolutePath, content> suitable for createMockFs.
 */
export function loadTemplateFixture(projectDir: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const relativePath of FIXTURE_FILES) {
    const templateFile = path.join(TEMPLATE_DIR, relativePath);
    if (fs.existsSync(templateFile)) {
      const absolutePath = path.join(projectDir, relativePath);
      result[absolutePath] = fs.readFileSync(templateFile, "utf-8");
    }
  }

  return result;
}

/**
 * Transform the fixture as if scaffoldProject had been called.
 * Applies the same package.json and README transformations.
 */
export function loadScaffoldedFixture(
  projectDir: string,
  projectName: string,
): Record<string, string> {
  const fixture = loadTemplateFixture(projectDir);
  const pkgPath = path.join(projectDir, "package.json");
  const readmePath = path.join(projectDir, "README.md");

  // Transform package.json
  if (fixture[pkgPath]) {
    const pkg = JSON.parse(fixture[pkgPath]);
    const kebabName = projectName
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase();

    pkg.name = kebabName;
    pkg.bin = { [kebabName]: "./dist/index.js" };
    pkg.version = "1.0.0";
    pkg.description = `MCP server for ${projectName}`;
    if (pkg.dependencies?.["@umbraco-cms/mcp-server-sdk"]) {
      pkg.dependencies["@umbraco-cms/mcp-server-sdk"] = "^17.0.0";
    }
    fixture[pkgPath] = JSON.stringify(pkg, null, 2) + "\n";
  }

  // Transform README
  if (fixture[readmePath]) {
    fixture[readmePath] = fixture[readmePath].replace(
      /^#\s+.+$/m,
      `# ${projectName}`
    );
  }

  return fixture;
}
