import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

export interface GenerateResult {
  success: boolean;
  error?: string;
}

export function generateClient(projectDir: string): GenerateResult {
  try {
    // Ensure dependencies are installed (Orval needs to be available)
    if (!fs.existsSync(path.join(projectDir, "node_modules"))) {
      execSync("npm install", {
        cwd: projectDir,
        stdio: "inherit",
        timeout: 120_000,
      });
    }

    execSync("npm run generate", {
      cwd: projectDir,
      stdio: "inherit",
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
