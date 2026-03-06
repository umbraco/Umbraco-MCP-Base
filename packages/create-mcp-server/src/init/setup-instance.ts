import * as fs from "node:fs";
import * as path from "node:path";
import { buildWithPsw } from "./psw-cli.js";

export interface SetupInstanceOptions {
  packageName: string;
  instanceDir: string;
  projectDir: string;
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

  // Copy McpOAuthComposer.cs into the instance if it exists in the project
  const composerSrc = path.join(opts.projectDir, "umbraco", "McpOAuthComposer.cs");
  if (fs.existsSync(composerSrc)) {
    const composerDest = path.join(instanceDir, "McpOAuthComposer.cs");
    fs.copyFileSync(composerSrc, composerDest);
  }

  // Patch Program.cs to disable OpenIddict transport security in development
  patchProgramCs(instanceDir);

  return {
    instanceDir: opts.instanceDir,
    adminEmail,
    adminPassword,
  };
}

const OPENIDDICT_SNIPPET = `
// Allow HTTP for token endpoint in development (workerd can't verify self-signed certs).
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddOpenIddict()
        .AddServer(options =>
        {
            options.UseAspNetCore()
                .DisableTransportSecurityRequirement();
        });
}

`;

/**
 * Patch Program.cs to add the OpenIddict transport security disable snippet.
 * Inserts the snippet before `WebApplication app = builder.Build();`.
 */
export function patchProgramCs(instanceDir: string): boolean {
  const programPath = path.join(instanceDir, "Program.cs");
  if (!fs.existsSync(programPath)) {
    return false;
  }

  let content = fs.readFileSync(programPath, "utf-8");

  // Already patched?
  if (content.includes("DisableTransportSecurityRequirement")) {
    return false;
  }

  // Insert before builder.Build()
  const buildLine = "WebApplication app = builder.Build();";
  const buildIndex = content.indexOf(buildLine);
  if (buildIndex === -1) {
    return false;
  }

  // Also add the using directive if not present
  const usingDirective = "using OpenIddict.Server.AspNetCore;";
  if (!content.includes(usingDirective)) {
    // Add at the top of the file
    content = usingDirective + "\n" + content;
  }

  // Re-find the build line index after potential using insertion
  const newBuildIndex = content.indexOf(buildLine);
  content =
    content.slice(0, newBuildIndex) +
    OPENIDDICT_SNIPPET +
    content.slice(newBuildIndex);

  fs.writeFileSync(programPath, content);
  return true;
}
