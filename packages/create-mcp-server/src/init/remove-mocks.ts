import * as fs from "node:fs";
import * as path from "node:path";

export function removeMocks(projectDir: string): number {
  let changes = 0;

  // Remove src/mocks/ directory
  const mocksDir = path.join(projectDir, "src", "mocks");
  if (fs.existsSync(mocksDir)) {
    fs.rmSync(mocksDir, { recursive: true, force: true });
    changes++;
  }

  // Update jest.config.ts - remove setupFilesAfterEnv
  const jestConfigPath = path.join(projectDir, "jest.config.ts");
  if (fs.existsSync(jestConfigPath)) {
    let content = fs.readFileSync(jestConfigPath, "utf-8");
    const original = content;
    content = content.replace(
      /^\s*setupFilesAfterEnv:\s*\[.*?\],?\s*\n/m,
      ""
    );
    if (content !== original) {
      fs.writeFileSync(jestConfigPath, content);
      changes++;
    }
  }

  // Update package.json - remove msw dependency
  const packageJsonPath = path.join(projectDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (pkg.devDependencies?.msw) {
      delete pkg.devDependencies.msw;
      fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
      changes++;
    }
  }

  return changes;
}
