import { execFileSync } from "node:child_process";
import pc from "picocolors";

export const PSW_VERSION = "1.2.0-alpha01";

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
  adminEmail?: string;
  adminPassword?: string;
}

export interface PswBuildResult {
  success: boolean;
  output?: string;
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
 * Detect whether PSW CLI is installed as a global dotnet tool.
 */
export function detectPsw(): PswDetectResult {
  try {
    const output = execFileSync("dotnet", ["tool", "list", "--global"], {
      encoding: "utf-8",
      timeout: 30_000,
    });

    for (const line of output.split("\n")) {
      // dotnet tool list output: "package-id    version    commands"
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
 * Install PSW CLI as a global dotnet tool.
 */
export function installPsw(): void {
  console.log(pc.dim(`  Installing PSW CLI v${PSW_VERSION}...`));
  try {
    execFileSync(
      "dotnet",
      [
        "tool",
        "install",
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
 * Build an Umbraco instance using the PSW CLI.
 *
 * Uses execFileSync to avoid shell injection from user-provided values
 * like connection strings.
 */
export function buildWithPsw(opts: PswBuildOptions): PswBuildResult {
  const args: string[] = [
    "-p",
    opts.packageName,
    "-n",
    opts.projectName,
    "-s",
    opts.solutionName,
    "-k",
    "clean",
    "-u",
    "--database-type",
    opts.databaseType,
    "--admin-email",
    opts.adminEmail ?? "admin@test.com",
    "--admin-password",
    opts.adminPassword ?? "SecurePass1234",
    "--auto-run",
    "--no-interaction",
    "--output",
    "json",
    "--run-dir",
    opts.runDir,
  ];

  console.log(pc.dim(`  $ psw ${args.join(" ")}`));

  try {
    const output = execFileSync("psw", args, {
      encoding: "utf-8",
      timeout: 600_000,
    });

    return { success: true, output };
  } catch (error: unknown) {
    const exitCode =
      error && typeof error === "object" && "status" in error
        ? (error as { status: number }).status
        : 1;

    const messages: Record<number, string> = {
      2: "PSW validation error — check package names and database type",
      3: "PSW network error — NuGet or template feed unreachable",
      4: "PSW execution error — dotnet script failed",
      5: "PSW filesystem error — check directory permissions",
    };

    const message =
      messages[exitCode] ??
      `PSW failed with exit code ${exitCode}: ${error instanceof Error ? error.message : error}`;

    throw new PswError(message, exitCode);
  }
}
