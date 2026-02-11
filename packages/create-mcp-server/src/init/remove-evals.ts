import * as fs from "node:fs";
import * as path from "node:path";

function findEvalsDirectories(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__evals__") {
        results.push(fullPath);
      } else if (entry.name !== "node_modules" && entry.name !== "dist") {
        findEvalsDirectories(fullPath, results);
      }
    }
  }
  return results;
}

export function removeEvals(projectDir: string): number {
  let changes = 0;

  // Find and remove all __evals__ directories
  const srcDir = path.join(projectDir, "src");
  const evalsDirs = findEvalsDirectories(srcDir);

  for (const evalsDir of evalsDirs) {
    fs.rmSync(evalsDir, { recursive: true, force: true });
    changes++;
  }

  // Update package.json - remove test:evals script
  const packageJsonPath = path.join(projectDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    let changed = false;

    if (pkg.scripts?.["test:evals"]) {
      delete pkg.scripts["test:evals"];
      changed = true;
    }

    if (pkg.scripts?.["test:all"]) {
      const testAll = pkg.scripts["test:all"];
      if (testAll.includes("__evals__") || testAll.includes("test:evals")) {
        pkg.scripts["test:all"] = pkg.scripts["test"];
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
      changes++;
    }
  }

  // Update jest.config.ts - remove __evals__ from testMatch
  const jestConfigPath = path.join(projectDir, "jest.config.ts");
  if (fs.existsSync(jestConfigPath)) {
    let content = fs.readFileSync(jestConfigPath, "utf-8");
    const original = content;

    content = content.replace(
      /,?\s*["']?\*\*\/__evals__\/\*\*\/\*\.eval\.ts["']?/g,
      ""
    );
    content = content.replace(/,(\s*\])/g, "$1");

    if (content !== original) {
      fs.writeFileSync(jestConfigPath, content);
      changes++;
    }
  }

  return changes;
}
