import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseConfig } from "./prompts.js";
import { buildWithPsw } from "./psw-cli.js";

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

/** Map prompt database choices to PSW --database-type values. */
function mapDatabaseType(db?: DatabaseConfig): string {
  if (!db) return "SQLite";

  switch (db.type) {
    case "sqlite":
      return "SQLite";
    case "localdb":
      return "LocalDB";
    case "sqlserver":
      return "SQLServer";
    case "sqlazure":
      return "SQLAzure";
    default:
      return "SQLite";
  }
}

export async function setupInstance(
  opts: SetupInstanceOptions,
): Promise<SetupInstanceResult> {
  const instanceDir = path.resolve(opts.instanceDir);
  const parentDir = path.dirname(instanceDir);
  const dirName = path.basename(instanceDir);

  // Pre-flight: ensure parent directory exists
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Pre-flight: check for solution collision
  const slnFile = path.join(parentDir, `${dirName}.sln`);
  if (fs.existsSync(slnFile)) {
    throw new Error(`Solution file already exists: ${slnFile}`);
  }

  // Pre-flight: check for directory collision (allow .gitkeep from scaffold)
  if (fs.existsSync(instanceDir)) {
    const entries = fs.readdirSync(instanceDir);
    const hasRealContent = entries.some((e) => e !== ".gitkeep");
    if (hasRealContent) {
      throw new Error(`Instance directory already exists: ${instanceDir}`);
    }
  }

  const adminEmail = "admin@test.com";
  const adminPassword = "SecurePass1234";

  buildWithPsw({
    packageName: opts.packageName,
    projectName: dirName,
    solutionName: dirName,
    runDir: parentDir,
    databaseType: mapDatabaseType(opts.database),
    adminEmail,
    adminPassword,
  });

  return {
    instanceDir: opts.instanceDir,
    adminEmail,
    adminPassword,
  };
}
