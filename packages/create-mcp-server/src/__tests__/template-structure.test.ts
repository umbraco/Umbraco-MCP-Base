/**
 * Template structure snapshot tests.
 *
 * Reads the real dist/template/ directory and snapshots:
 * - File listing (catches unintended additions/removals)
 * - Transformed package.json for a sample project
 * - Transformed README.md for a sample project
 *
 * Fast — reads real filesystem but doesn't scaffold anything.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.resolve(__dirname, "../../dist/template");

function listFilesRecursive(dir: string, base = ""): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(path.join(dir, entry.name), relative));
    } else {
      results.push(relative);
    }
  }

  return results;
}

describe("template structure", () => {
  it("should match the expected file listing", () => {
    const files = listFilesRecursive(TEMPLATE_DIR).sort();
    expect(files).toMatchSnapshot();
  });

  it("should produce expected package.json for sample project", () => {
    const raw = fs.readFileSync(
      path.join(TEMPLATE_DIR, "package.json"),
      "utf-8"
    );
    const pkg = JSON.parse(raw);

    // Apply the same transforms as scaffoldProject
    const projectName = "My-Commerce-MCP";
    const kebabName = "my-commerce-mcp";

    pkg.name = kebabName;
    pkg.bin = { [kebabName]: "./dist/index.js" };
    pkg.version = "1.0.0";
    pkg.description = `MCP server for ${projectName}`;
    if (pkg.dependencies?.["@umbraco-cms/mcp-server-sdk"]) {
      pkg.dependencies["@umbraco-cms/mcp-server-sdk"] = "^17.0.0";
    }

    expect(JSON.stringify(pkg, null, 2)).toMatchSnapshot();
  });

  it("should produce expected README.md for sample project", () => {
    const raw = fs.readFileSync(
      path.join(TEMPLATE_DIR, "README.md"),
      "utf-8"
    );
    const transformed = raw.replace(/^#\s+.+$/m, "# My-Commerce-MCP");
    expect(transformed).toMatchSnapshot();
  });
});
