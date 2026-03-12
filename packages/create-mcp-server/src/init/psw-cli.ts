import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import pc from "picocolors";

export const PSW_VERSION = "1.2.0-alpha03";

export interface PswDetectResult {
  installed: boolean;
  version?: string;
}

export interface PswBuildOptions {
  packageName: string;
  projectName: string;
  solutionName: string;
  runDir: string;
  databaseType: string;
  connectionString?: string;
  adminEmail?: string;
  adminPassword?: string;
}

export interface PswBuildResult {
  success: boolean;
}

export class PswError extends Error {
  constructor(
    message: string,
    public exitCode: number,
  ) {
    super(message);
    this.name = "PswError";
  }
}

/**
 * Resolve the full path to the PSW executable.
 * .NET global tools install to ~/.dotnet/tools/ which may not be in PATH.
 */
function resolvePswPath(): string {
  const toolsDir = path.join(os.homedir(), ".dotnet", "tools");
  const exe = process.platform === "win32" ? "psw.exe" : "psw";
  const fullPath = path.join(toolsDir, exe);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  return "psw";
}

/** Build env with ~/.dotnet/tools on PATH. */
function buildEnv(): NodeJS.ProcessEnv {
  const dotnetToolsDir = path.join(os.homedir(), ".dotnet", "tools");
  return {
    ...process.env,
    PATH: `${dotnetToolsDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

/**
 * Detect whether PSW CLI is installed as a global dotnet tool.
 */
export function detectPsw(): PswDetectResult {
  try {
    const output = execFileSync("dotnet", ["tool", "list", "--global"], {
      encoding: "utf-8",
      timeout: 30_000,
    });

    for (const line of output.split("\n")) {
      const lower = line.toLowerCase();
      if (lower.includes("packagescriptwriter.cli")) {
        const parts = line.trim().split(/\s+/);
        return { installed: true, version: parts[1] };
      }
    }

    return { installed: false };
  } catch {
    return { installed: false };
  }
}

/**
 * Install or update PSW CLI as a global dotnet tool.
 * Uses `dotnet tool update` which handles both fresh installs and upgrades.
 */
export function installPsw(): void {
  console.log(pc.dim(`  Installing PSW CLI v${PSW_VERSION}...`));
  try {
    execFileSync(
      "dotnet",
      [
        "tool",
        "update",
        "--global",
        "PackageScriptWriter.Cli",
        "--version",
        PSW_VERSION,
      ],
      { encoding: "utf-8", timeout: 120_000, stdio: "inherit" },
    );
  } catch (error) {
    throw new PswError(
      `Failed to install PSW CLI: ${error instanceof Error ? error.message : error}`,
      1,
    );
  }
}

/**
 * Build an Umbraco instance using PSW CLI.
 *
 * Uses `--auto-run --build-only --no-interaction` to have PSW generate and
 * execute the full installation script (template install, solution, project,
 * packages) while skipping `dotnet run`.
 *
 * Uses execFileSync to avoid shell injection from user-provided values
 * like connection strings.
 */
export function buildWithPsw(opts: PswBuildOptions): PswBuildResult {
  const pswPath = resolvePswPath();
  const env = buildEnv();
  const cwd = opts.runDir;

  const args: string[] = [
    "-d", // IMPORTANT: --default is required to generate the full script (solution, project, packages). Without it PSW only generates the "Add Packages" step.
    "-p", opts.packageName,
    "-n", opts.projectName,
    "-s", opts.solutionName,
    "-k", "clean",
    "--database-type", opts.databaseType,
    "--admin-email", opts.adminEmail ?? "admin@test.com",
    "--admin-password", opts.adminPassword ?? "SecurePass1234",
    "--auto-run",
    "--build-only",
    "--run-dir", cwd,
    "--no-interaction",
    ...(opts.connectionString
      ? ["--connection-string", opts.connectionString]
      : []),
  ];

  console.log(pc.dim(`  $ psw ${args.join(" ")}`));

  try {
    execFileSync(pswPath, args, {
      encoding: "utf-8",
      timeout: 300_000,
      stdio: "inherit",
      cwd,
      env,
    });
  } catch (error: unknown) {
    const exitCode =
      error && typeof error === "object" && "status" in error
        ? (error as { status: number }).status
        : 1;
    throw new PswError(
      `PSW failed with exit code ${exitCode}`,
      exitCode,
    );
  }

  return { success: true };
}
