import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { buildWithPsw } from "./psw-cli.js";
import {
  getLatestPackageVersionForMajor,
  getLatestVersionByDependencyMajor,
} from "./nuget-versions.js";

const DEVELOPMENT_MODE_PACKAGE = "Umbraco.Cms.DevelopmentMode.Backoffice";

// The starter kit's dependency that tracks the CMS major (clean 7.x depends on
// Umbraco.Cms.Web.Website 17.x, clean 8.x on 18.x). We match the kit version by
// this dependency rather than the kit's own version, which versions separately.
const KIT_CMS_DEPENDENCY = "Umbraco.Cms.Web.Website";

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
  // line (7.x → Umbraco 17, 8.x → 18), NOT in lockstep with the CMS major, and a
  // bare "clean" resolves to the single latest-stable kit overall — which only
  // ever suits one major. Dropping the wrong major's kit onto a site aborts boot
  // (a 17 kit on Umbraco 18 drags in Swashbuckle, which 18 removed; a kit's package
  // migration may also call APIs the other major removed). So always pin to the kit
  // version whose Umbraco dependency matches the CMS major.
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
 * Resolve the PSW starter-kit argument, pinning the kit version to the one whose
 * Umbraco dependency matches the CMS major.
 *
 * Starter kits version on their own line, not in lockstep with the CMS major, and
 * a bare kit name resolves to the single latest-stable kit overall — which only
 * suits whichever major happens to be "latest stable" right now (clean 7.0.7 → 17
 * today; once clean 8.x goes stable, that would flip to 18 and break the 17 leg).
 * Matching by the kit's Umbraco dependency keeps every CMS major correct: stable
 * when one exists, the newest prerelease otherwise (Umbraco 18 has only clean
 * 8.x prereleases today).
 *
 * Throws when no kit version targets the CMS major (or NuGet is unreachable) —
 * we fail loudly rather than let PSW silently install a mismatched kit that
 * aborts the site's boot. Returns the bare kit name only when no CMS version is
 * known (interactive default), where PSW's latest-stable pick is acceptable.
 */
export async function resolveStarterKit(
  kit: string,
  umbracoVersion?: string,
): Promise<string> {
  if (!umbracoVersion) return kit;

  const major = parseInt(umbracoVersion.split(".")[0], 10);
  if (Number.isNaN(major)) return kit;

  const version = await getLatestVersionByDependencyMajor(
    kit,
    KIT_CMS_DEPENDENCY,
    major,
  );
  if (!version) {
    throw new Error(
      `No "${kit}" starter-kit version found targeting Umbraco ${major} ` +
        `(checked its ${KIT_CMS_DEPENDENCY} dependency on NuGet). A kit built for ` +
        `a different CMS major aborts the site's boot, so refusing to scaffold with ` +
        `a mismatched kit. Pin a compatible kit version, pick another kit, or retry ` +
        `if NuGet was unreachable.`,
    );
  }
  return `${kit}|${version}`;
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
