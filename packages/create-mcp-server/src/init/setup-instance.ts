import * as fs from "node:fs";
import * as path from "node:path";
import { buildWithPsw } from "./psw-cli.js";

export interface SetupInstanceOptions {
  packageName: string;
  instanceDir: string;
  instanceName?: string;
  connectionString?: string;
}

export interface SetupInstanceResult {
  instanceDir: string;
  adminEmail: string;
  adminPassword: string;
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
    // Remove .gitkeep so PSW sees an empty directory
    const gitkeepPath = path.join(instanceDir, ".gitkeep");
    if (fs.existsSync(gitkeepPath)) {
      fs.unlinkSync(gitkeepPath);
    }
  }

  const adminEmail = "admin@test.com";
  const adminPassword = "SecurePass1234";

  buildWithPsw({
    packageName: opts.packageName,
    projectName: dirName,
    solutionName: dirName,
    runDir: parentDir,
    databaseType: "SQLServer",
    connectionString: opts.connectionString,
    adminEmail,
    adminPassword,
  });

  return {
    instanceDir: opts.instanceDir,
    adminEmail,
    adminPassword,
  };
}
