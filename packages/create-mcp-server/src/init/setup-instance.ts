import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import pc from "picocolors";
import type { DatabaseConfig } from "./prompts.js";

export interface SetupInstanceOptions {
  packageName: string;
  instanceDir: string;
  instanceName?: string;
  database?: DatabaseConfig;
}

export interface SetupInstanceResult {
  instanceDir: string;
  adminEmail: string;
  adminPassword: string;
}

function run(cmd: string, cwd: string): void {
  console.log(pc.dim(`  $ ${cmd}`));
  execSync(cmd, { cwd, stdio: "inherit", timeout: 300_000 });
}

function buildInstance(opts: SetupInstanceOptions): void {
  const instanceDir = path.resolve(opts.instanceDir);
  const parentDir = path.dirname(instanceDir);
  const dirName = path.basename(instanceDir);

  // Ensure parent directory exists
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Check if instance already exists
  const slnFile = path.join(parentDir, `${dirName}.sln`);
  if (fs.existsSync(slnFile)) {
    throw new Error(`Solution file already exists: ${slnFile}`);
  }
  if (fs.existsSync(instanceDir)) {
    // Allow if directory only contains .gitkeep (from template scaffold)
    const entries = fs.readdirSync(instanceDir);
    const hasRealContent = entries.some((e) => e !== ".gitkeep");
    if (hasRealContent) {
      throw new Error(`Instance directory already exists: ${instanceDir}`);
    }
  }

  // Database configuration
  const db = opts.database;
  const hasConnectionString = db?.type === "connection-string" && db.connectionString;

  // --development-database-type only supports LocalDB, None, SQLite
  // For SQL Server, use --connection-string instead (no --development-database-type)
  const dbArgs = hasConnectionString
    ? ` --connection-string "${db.connectionString}"`
    : " --development-database-type SQLite";

  // Install Umbraco templates
  run("dotnet new install Umbraco.Templates --force", parentDir);

  // Create solution and project
  run(`dotnet new sln --name "${dirName}"`, parentDir);
  run(
    `dotnet new umbraco --force -n "${dirName}"` +
      ` --friendly-name "Administrator"` +
      ` --email "admin@test.com" --password "SecurePass1234"` +
      dbArgs,
    parentDir
  );
  run(`dotnet sln add "${dirName}"`, parentDir);

  // Add starter kit
  run(`dotnet add "${dirName}" package clean`, parentDir);

  // Add requested packages
  const packages = opts.packageName
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const pkg of packages) {
    // Support "PackageName|Version" format
    const [name, version] = pkg.split("|");
    const versionArg = version ? ` --version ${version}` : "";
    run(`dotnet add "${dirName}" package ${name}${versionArg}`, parentDir);
  }

  // Build only — do NOT run
  run(`dotnet build "${dirName}"`, parentDir);
}

export async function setupInstance(
  opts: SetupInstanceOptions,
): Promise<SetupInstanceResult> {
  buildInstance(opts);

  return {
    instanceDir: opts.instanceDir,
    adminEmail: "admin@test.com",
    adminPassword: "SecurePass1234",
  };
}
