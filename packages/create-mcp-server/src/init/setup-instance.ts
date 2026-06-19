import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { buildWithPsw } from "./psw-cli.js";
import { fetchNugetVersions, getLatestPackageVersionForMajor } from "./nuget-versions.js";

const DEVELOPMENT_MODE_PACKAGE = "Umbraco.Cms.DevelopmentMode.Backoffice";

export interface SetupInstanceOptions {
  packageName: string;
  instanceDir: string;
  projectDir: string;
  instanceName?: string;
  connectionString?: string;
  /** Umbraco version to install (e.g. "17.3.1" LTS, "18.0.0", "18.0.0-rc4"). Defaults to latest. */
  umbracoVersion?: string;
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

  // Resolve the chosen add-on to a version matching the CMS major (PSW installs
  // latest stable by default, which on a prerelease/older CMS would be the wrong
  // major). DevelopmentMode registers the umbraco-swagger OAuth client that
  // checkApiUser needs for the discover flow.
  const [packageVersion, extraPackages] = await Promise.all([
    resolvePackageVersion(opts.packageName, opts.umbracoVersion),
    resolveExtraPackages(opts.umbracoVersion),
  ]);
  if (packageVersion) {
    console.log(
      pc.dim(`  Pinning ${opts.packageName} to ${packageVersion} to match Umbraco ${opts.umbracoVersion}`),
    );
  }

  // Pin the starter kit to a CMS-compatible version. "clean" versions on its own
  // line (7.x → Umbraco 17, 8.x → 18), NOT in lockstep with the CMS major, and PSW
  // installs the latest STABLE — which lags a prerelease CMS. Installing the stable
  // clean (7.x) on Umbraco 18 fails the boot: its package migration calls APIs
  // removed in 18 (MethodNotFound: PublishResult.Content). So for a prerelease CMS,
  // use the latest clean prerelease (the build that targets the new major).
  const starterKit = await resolveStarterKit("clean", opts.umbracoVersion);

  buildWithPsw({
    packageName: opts.packageName,
    projectName: dirName,
    solutionName: dirName,
    runDir: parentDir,
    databaseType: "SQLServer",
    connectionString: opts.connectionString,
    adminEmail,
    adminPassword,
    umbracoVersion: opts.umbracoVersion,
    packageVersion,
    extraPackages,
    starterKit,
  });

  // Write connection string and unattended install config to appsettings
  if (opts.connectionString) {
    configureAppsettings(instanceDir, opts.connectionString, adminEmail, adminPassword);
  }

  // Copy McpOAuthComposer.cs into the instance if it exists in the project
  const composerSrc = path.join(opts.projectDir, "umbraco", "McpOAuthComposer.cs");
  if (fs.existsSync(composerSrc)) {
    const composerDest = path.join(instanceDir, "McpOAuthComposer.cs");
    fs.copyFileSync(composerSrc, composerDest);
  }

  // Patch Program.cs to disable OpenIddict transport security in development
  patchProgramCs(instanceDir);

  // WORKAROUND: Umbraco 17.3 regression — crashes on startup without wwwroot/media/
  // See: https://github.com/umbraco/Umbraco-CMS/issues/22355
  // Remove this when the issue is fixed upstream.
  const mediaDir = path.join(instanceDir, "wwwroot", "media");
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  return {
    instanceDir: opts.instanceDir,
    adminEmail,
    adminPassword,
  };
}

/**
 * Resolve the add-on package version to install for a given Umbraco version.
 *
 * Returns the package's latest version sharing the CMS major (matching the
 * CMS's prerelease state), or undefined when no Umbraco version was requested,
 * NuGet is unreachable, or the package has no version for that major — in which
 * case PSW falls back to its default (latest) resolution.
 */
export async function resolvePackageVersion(
  packageName: string,
  umbracoVersion?: string,
): Promise<string | undefined> {
  if (!umbracoVersion) return undefined;

  const major = parseInt(umbracoVersion.split(".")[0], 10);
  if (Number.isNaN(major)) return undefined;

  const includePrerelease = umbracoVersion.includes("-");
  return getLatestPackageVersionForMajor(packageName, major, { includePrerelease });
}

/**
 * Build the list of supporting packages PSW should install alongside the chosen
 * add-on. Currently just DevelopmentMode — which registers the umbraco-swagger
 * OAuth client the discover flow authenticates with — version-matched to the CMS
 * major (PSW installs latest stable by default, the wrong major for a prerelease
 * or older CMS).
 */
export async function resolveExtraPackages(
  umbracoVersion?: string,
): Promise<Array<{ name: string; version?: string }>> {
  return [
    { name: DEVELOPMENT_MODE_PACKAGE, version: await resolvePackageVersion(DEVELOPMENT_MODE_PACKAGE, umbracoVersion) },
  ];
}

/**
 * Resolve the PSW starter-kit argument, pinning a version when needed.
 *
 * Starter kits version on their own line, not in lockstep with the CMS major, so
 * the major-matching used for add-ons doesn't apply. PSW installs the latest
 * STABLE kit, which is correct for a stable CMS but lags a prerelease CMS (e.g.
 * clean 7.x stable vs the clean 8.0.0-rc that targets Umbraco 18). So:
 *  - stable / unspecified CMS → return the bare kit name (PSW picks latest stable),
 *  - prerelease CMS → pin to the kit's latest version (incl. prerelease), which is
 *    the build targeting the new major, via PSW's "kit|version" syntax.
 *
 * Returns undefined only if the kit can't be resolved, leaving PSW to default.
 */
export async function resolveStarterKit(
  kit: string,
  umbracoVersion?: string,
): Promise<string> {
  if (!umbracoVersion || !umbracoVersion.includes("-")) return kit;

  const versions = await fetchNugetVersions(kit); // newest-first, incl. prerelease
  const latest = versions[0];
  return latest ? `${kit}|${latest}` : kit;
}

/**
 * Write connection string to appsettings.local.json and unattended install config
 * to appsettings.Development.json. PSW with --build-only doesn't persist these.
 *
 * Connection string goes in appsettings.local.json (gitignored) to keep credentials
 * out of version control. Program.cs is patched to load this file explicitly since
 * ASP.NET Core doesn't load it by default.
 */
function configureAppsettings(
  instanceDir: string,
  connectionString: string,
  adminEmail: string,
  adminPassword: string,
): void {
  // 1. Write connection string to appsettings.local.json (gitignored)
  const localPath = path.join(instanceDir, "appsettings.local.json");
  let localSettings: Record<string, unknown> = {};
  if (fs.existsSync(localPath)) {
    localSettings = JSON.parse(fs.readFileSync(localPath, "utf-8"));
  }
  localSettings.ConnectionStrings = {
    umbracoDbDSN: connectionString,
    umbracoDbDSN_ProviderName: "Microsoft.Data.SqlClient",
  };
  fs.writeFileSync(localPath, JSON.stringify(localSettings, null, 2) + "\n");

  // 2. Write unattended install config to appsettings.Development.json
  const devPath = path.join(instanceDir, "appsettings.Development.json");
  let devSettings: Record<string, unknown> = {};
  if (fs.existsSync(devPath)) {
    devSettings = JSON.parse(fs.readFileSync(devPath, "utf-8"));
  }

  const umbraco = (devSettings.Umbraco ?? {}) as Record<string, unknown>;
  const cms = (umbraco.CMS ?? {}) as Record<string, unknown>;
  cms.Unattended = {
    InstallUnattended: true,
    UnattendedUserName: "Administrator",
    UnattendedUserEmail: adminEmail,
    UnattendedUserPassword: adminPassword,
  };
  umbraco.CMS = cms;
  devSettings.Umbraco = umbraco;

  fs.writeFileSync(devPath, JSON.stringify(devSettings, null, 2) + "\n");
}

const OPENIDDICT_SNIPPET = `
// Load appsettings.local.json for local overrides (connection string, secrets).
// This file is gitignored so credentials stay out of version control.
builder.Configuration.AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: true);

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
