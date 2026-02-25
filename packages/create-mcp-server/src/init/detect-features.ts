import * as fs from "node:fs";
import * as path from "node:path";

export interface ProjectFeatures {
  hasMocks: boolean;
  hasChaining: boolean;
  hasExamples: boolean;
  hasEvals: boolean;
}

export interface DetectResult {
  projectDir: string;
  valid: boolean;
  missing?: string[];
  projectName?: string;
  features?: ProjectFeatures;
}

export function detectFeatures(projectDir: string): DetectResult {
  const resolvedDir = path.resolve(projectDir);
  const result: DetectResult = {
    projectDir: resolvedDir,
    valid: false,
  };

  // Verify project structure
  const requiredFiles = ["package.json", "src/index.ts", "orval.config.ts"];
  const missing: string[] = [];

  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(resolvedDir, file))) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    result.missing = missing;
    return result;
  }

  // Verify SDK dependency
  const pkgPath = path.join(resolvedDir, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const hasSdk =
      pkg.dependencies?.["@umbraco-cms/mcp-server-sdk"] ||
      pkg.devDependencies?.["@umbraco-cms/mcp-server-sdk"];

    if (!hasSdk) {
      result.missing = ["@umbraco-cms/mcp-server-sdk dependency"];
      return result;
    }

    result.valid = true;
    result.projectName = pkg.name;
  } catch {
    result.missing = ["valid package.json"];
    return result;
  }

  // Detect features
  result.features = {
    hasMocks: fs.existsSync(path.join(resolvedDir, "src/mocks")),
    hasChaining: fs.existsSync(
      path.join(resolvedDir, "src/config/mcp-servers.ts")
    ),
    hasExamples:
      fs.existsSync(
        path.join(resolvedDir, "src/umbraco-api/tools/example")
      ) ||
      fs.existsSync(
        path.join(resolvedDir, "src/umbraco-api/tools/example-2")
      ),
    hasEvals: fs.existsSync(path.join(resolvedDir, "tests/evals")),
  };

  return result;
}
