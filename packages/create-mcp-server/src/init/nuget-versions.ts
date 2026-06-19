/**
 * Fetch Umbraco CMS versions from NuGet.
 *
 * Used by both the version picker (prompts.ts) and E2E tests to resolve
 * available versions without duplicating the NuGet API call.
 *
 * The minimum major version is derived from this package's version
 * (e.g. 17.0.0-beta.8 → major 17) so it stays in sync automatically.
 */

import pkg from "../../package.json" with { type: "json" };
const MIN_MAJOR = parseInt(pkg.version.split(".")[0], 10);

/**
 * Fetch all published versions of any NuGet package, newest first.
 * Includes stable and prerelease (RC, beta, alpha). Returns [] on any error.
 */
export async function fetchNugetVersions(packageId: string): Promise<string[]> {
  const url = `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/index.json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) return [];

  const data = (await resp.json()) as { versions?: string[] };
  // NuGet's flatcontainer lists versions oldest-first; reverse to newest-first.
  return (data.versions ?? []).slice().reverse();
}

/**
 * Fetch Umbraco CMS versions from NuGet, newest first.
 * Filtered to the current major version and above.
 * Includes stable and prerelease (RC, beta, alpha).
 */
export async function fetchUmbracoVersions(): Promise<string[]> {
  const versions = await fetchNugetVersions("umbraco.cms");
  return versions.filter((v) => parseInt(v.split(".")[0], 10) >= MIN_MAJOR);
}

/**
 * Get the latest stable (non-prerelease) Umbraco version.
 * Returns undefined if the NuGet API is unreachable.
 */
export async function getLatestStableVersion(): Promise<string | undefined> {
  try {
    const versions = await fetchUmbracoVersions();
    return versions.find((v) => !v.includes("-"));
  } catch {
    return undefined;
  }
}

/**
 * Get the latest Umbraco version for a specific major (e.g. 17 or 18).
 * Used to pin E2E test legs to a given major regardless of which major is
 * currently "latest stable". Prereleases (RC/beta) are excluded unless
 * `includePrerelease` is set — needed for majors that have no stable yet.
 * Returns undefined if the NuGet API is unreachable or no match is found.
 */
export async function getLatestVersionForMajor(
  major: number,
  opts: { includePrerelease?: boolean } = {},
): Promise<string | undefined> {
  try {
    const versions = await fetchUmbracoVersions();
    return pickLatestForMajor(versions, major, opts);
  } catch {
    return undefined;
  }
}

/**
 * Get the latest version of an arbitrary NuGet package for a specific major.
 *
 * Used to keep an Umbraco add-on (e.g. Umbraco.Forms) in step with the CMS
 * major being installed: a CMS-17 add-on dropped onto a CMS-18 site fails to
 * boot (Umbraco 18 removed Swashbuckle, which 17.x add-ons reference). Returns
 * undefined when NuGet is unreachable or the package has no version for that
 * major — callers should then fall back to PSW's default (latest) resolution.
 */
export async function getLatestPackageVersionForMajor(
  packageId: string,
  major: number,
  opts: { includePrerelease?: boolean } = {},
): Promise<string | undefined> {
  try {
    const versions = await fetchNugetVersions(packageId);
    return pickLatestForMajor(versions, major, opts);
  } catch {
    return undefined;
  }
}

/** Pick the newest version matching `major` from a newest-first list. */
function pickLatestForMajor(
  versions: string[],
  major: number,
  opts: { includePrerelease?: boolean },
): string | undefined {
  return versions.find((v) => {
    if (parseInt(v.split(".")[0], 10) !== major) return false;
    if (!opts.includePrerelease && v.includes("-")) return false;
    return true;
  });
}
