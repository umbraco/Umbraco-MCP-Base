import * as fs from "node:fs";
import * as path from "node:path";

export function removeEvals(projectDir: string): number {
  let changes = 0;

  // Remove tests/evals/ directory
  const evalsDir = path.join(projectDir, "tests/evals");
  if (fs.existsSync(evalsDir)) {
    fs.rmSync(evalsDir, { recursive: true, force: true });
    changes++;

    // Remove tests/ directory if now empty
    const testsDir = path.join(projectDir, "tests");
    if (fs.existsSync(testsDir)) {
      const remaining = fs.readdirSync(testsDir);
      if (remaining.length === 0) {
        fs.rmSync(testsDir, { recursive: true, force: true });
      }
    }
  }

  // Update package.json - remove test:evals script and simplify test:all
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
      if (testAll.includes("tests/evals") || testAll.includes("test:evals")) {
        pkg.scripts["test:all"] = pkg.scripts["test"];
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
      changes++;
    }
  }

  return changes;
}
