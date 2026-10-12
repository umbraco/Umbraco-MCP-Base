import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { isLoopbackUrl } from "../loopback.js";

export interface GenerateResult {
  success: boolean;
  error?: string;
}

/**
 * @param baseUrl - The Umbraco base URL. Only a loopback URL (a local site with a
 *   self-signed certificate) relaxes TLS verification for the generate step.
 */
export function generateClient(projectDir: string, baseUrl?: string): GenerateResult {
  try {
    // Ensure dependencies are installed (Orval needs to be available)
    // Always run install — node_modules may exist but be incomplete
    execSync("npm install", {
      cwd: projectDir,
      stdio: "inherit",
      timeout: 120_000,
    });

    execSync("npm run generate", {
      cwd: projectDir,
      stdio: "inherit",
      timeout: 180_000,
      env: {
        ...process.env,
        // Codegen also fetches the OpenAPI document outside the SDK, so a local
        // self-signed site needs the process-wide switch. Never for a remote URL.
        ...(baseUrl && isLoopbackUrl(baseUrl)
          ? { NODE_TLS_REJECT_UNAUTHORIZED: "0", UMBRACO_ALLOW_SELF_SIGNED_LOCALHOST: "true" }
          : {}),
      },
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
