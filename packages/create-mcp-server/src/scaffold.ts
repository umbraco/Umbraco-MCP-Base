import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { shouldExclude } from "./exclusions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the SDK version to use, derived from this package's own version.
 * Both packages are published together with matching versions.
 */
function getDefaultSdkVersion(): string {
  const pkgPath = path.resolve(__dirname, "..", "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "^17.0.0";
  } catch {
    return "^17.0.0";
  }
}

/**
 * Get the path to the bundled template directory.
 */
function getTemplatePath(): string {
  // In the built package, template is at dist/template/
  return path.resolve(__dirname, "template");
}

/**
 * Convert a project name to kebab-case package name.
 * E.g., "Umbraco-Commerce-Developer-MCP" -> "umbraco-commerce-developer-mcp"
 */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Transform the template package.json for the new project.
 */
function transformPackageJson(
  content: string,
  projectName: string,
  sdkVersion: string
): string {
  const pkg = JSON.parse(content);
  const kebabName = toKebabCase(projectName);

  // Update name
  pkg.name = kebabName;

  // Update bin command name
  pkg.bin = {
    [kebabName]: "./dist/index.js",
  };

  // Update SDK dependency from file: path to published version
  if (pkg.dependencies?.["@umbraco-cms/mcp-server-sdk"]) {
    pkg.dependencies["@umbraco-cms/mcp-server-sdk"] = sdkVersion;
  }

  // Clear template-specific fields
  pkg.version = "1.0.0";
  pkg.description = `MCP server for ${projectName}`;

  return JSON.stringify(pkg, null, 2) + "\n";
}

/**
 * Transform README.md title for the new project.
 */
function transformReadme(content: string, projectName: string): string {
  // Replace the first heading with the project name
  return content.replace(/^#\s+.+$/m, `# ${projectName}`);
}

/**
 * Copy a directory recursively, applying transformations and exclusions.
 */
function copyDirectory(
  src: string,
  dest: string,
  projectName: string,
  sdkVersion: string,
  basePath: string = ""
): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    // Check exclusions
    if (shouldExclude(relativePath)) {
      continue;
    }

    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirectory(srcPath, destPath, projectName, sdkVersion, relativePath);
    } else {
      let content = fs.readFileSync(srcPath, "utf-8");

      // Apply transformations based on filename
      if (entry.name === "package.json") {
        content = transformPackageJson(content, projectName, sdkVersion);
      } else if (entry.name === "README.md") {
        content = transformReadme(content, projectName);
      }

      fs.writeFileSync(destPath, content);
    }
  }
}

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  sdkVersion?: string;
}

/**
 * Scaffold a new project from the bundled template.
 */
export function scaffoldProject(options: ScaffoldOptions): void {
  const { projectName, targetDir, sdkVersion = getDefaultSdkVersion() } = options;
  const templatePath = getTemplatePath();

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Template directory not found at ${templatePath}. ` +
        "This may indicate an incomplete package installation."
    );
  }

  console.log(pc.cyan(`\nCreating project in ${pc.bold(targetDir)}...`));

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy and transform files
  copyDirectory(templatePath, targetDir, projectName, sdkVersion);

  console.log(pc.green("\nProject created successfully!"));
  console.log(pc.dim("\nNext steps:"));
  console.log(pc.dim(`  cd ${path.basename(targetDir)}`));
  console.log(pc.dim("  npm install"));
  console.log(pc.dim("  npx @umbraco-cms/create-umbraco-mcp-server init"));
}
