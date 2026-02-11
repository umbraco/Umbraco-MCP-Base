import * as fs from "node:fs";
import * as path from "node:path";

export interface VerifyResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  toolCollections: string[];
}

export function verifyProject(projectDir: string): VerifyResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const toolCollections: string[] = [];

  // Check package.json
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    issues.push("package.json not found");
  } else {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      const hasSdk =
        pkg.dependencies?.["@umbraco-cms/mcp-server-sdk"] ||
        pkg.devDependencies?.["@umbraco-cms/mcp-server-sdk"];

      if (!hasSdk) {
        issues.push("Missing @umbraco-cms/mcp-server-sdk dependency");
      }

      const hasMcpSdk =
        pkg.dependencies?.["@modelcontextprotocol/sdk"] ||
        pkg.devDependencies?.["@modelcontextprotocol/sdk"];

      if (!hasMcpSdk) {
        issues.push("Missing @modelcontextprotocol/sdk dependency");
      }
    } catch (e) {
      issues.push(
        `Invalid package.json: ${e instanceof Error ? e.message : e}`
      );
    }
  }

  // Required files
  const requiredFiles = [
    { path: "src/index.ts", description: "MCP server entry point" },
    { path: "orval.config.ts", description: "Orval API generation config" },
    { path: "tsconfig.json", description: "TypeScript configuration" },
    { path: "jest.config.ts", description: "Jest test configuration" },
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(projectDir, file.path))) {
      issues.push(`Missing ${file.path}`);
    }
  }

  // Required directories
  const requiredDirs = [
    "src",
    "src/config",
    "src/umbraco-api",
  ];

  for (const dir of requiredDirs) {
    const dirPath = path.join(projectDir, dir);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      issues.push(`Missing ${dir}/`);
    }
  }

  // Optional files
  const optionalFiles = [
    "src/mocks/server.ts",
    "src/config/mcp-servers.ts",
    ".env.example",
    "README.md",
  ];

  for (const file of optionalFiles) {
    if (!fs.existsSync(path.join(projectDir, file))) {
      warnings.push(`Optional: ${file}`);
    }
  }

  // Check for tool collections
  const toolsDir = path.join(projectDir, "src", "umbraco-api", "tools");
  if (
    fs.existsSync(toolsDir) &&
    fs.statSync(toolsDir).isDirectory()
  ) {
    const dirs = fs
      .readdirSync(toolsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    toolCollections.push(...dirs);
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    toolCollections,
  };
}
