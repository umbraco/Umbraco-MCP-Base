/**
 * MCP Inspector lifecycle for E2E tests.
 *
 * Starts the MCP Inspector as a child process and captures the URL with auth token.
 * Uses dedicated ports (6284 for UI, 6287 for proxy) to avoid conflicts.
 */

import { spawn, type ChildProcess } from "node:child_process";

const INSPECTOR_PORT = 6284;
const INSPECTOR_PROXY_PORT = 6287;

let inspectorProcess: ChildProcess | undefined;
let inspectorUrl: string | undefined;

export async function startInspector(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for MCP Inspector to start"));
    }, 30000);

    inspectorProcess = spawn(
      "npx",
      ["@modelcontextprotocol/inspector"],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: {
          ...process.env,
          CLIENT_PORT: String(INSPECTOR_PORT),
          SERVER_PORT: String(INSPECTOR_PROXY_PORT),
        },
      },
    );

    let output = "";

    inspectorProcess.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      // Look for the URL line
      const match = output.match(
        /MCP Inspector is up and running at:\s+(http:\/\/localhost:\d+\S+)/,
      );
      if (match) {
        clearTimeout(timer);
        inspectorUrl = match[1];
        resolve(inspectorUrl);
      }
    });

    inspectorProcess.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    inspectorProcess.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`MCP Inspector failed to start: ${err.message}`));
    });

    inspectorProcess.on("exit", (code) => {
      if (!inspectorUrl) {
        clearTimeout(timer);
        reject(
          new Error(
            `MCP Inspector exited with code ${code} before ready.\nOutput: ${output}`,
          ),
        );
      }
    });
  });
}

export async function stopInspector(): Promise<void> {
  if (inspectorProcess) {
    const proc = inspectorProcess;
    inspectorProcess = undefined;
    inspectorUrl = undefined;

    // Kill the process group (inspector spawns child processes)
    try {
      process.kill(-proc.pid!, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }

    // Wait for exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* ignore */ }
        resolve();
      }, 5000);
      proc.on("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
}

export function getInspectorUrl(): string {
  if (!inspectorUrl) {
    throw new Error("Inspector not started. Call startInspector() first.");
  }
  return inspectorUrl;
}
