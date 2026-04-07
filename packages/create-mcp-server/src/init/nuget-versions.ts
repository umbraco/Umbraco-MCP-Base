/**
 * Fetch Umbraco CMS versions from NuGet.
 *
 * Used by both the version picker (prompts.ts) and E2E tests to resolve
 * available versions without duplicating the NuGet API call.
 */

const NUGET_INDEX_URL =
  "https://api.nuget.org/v3-flatcontainer/umbraco.cms/index.json";

/**
 * Fetch all Umbraco CMS versions (17.x+) from NuGet, newest first.
 * Includes stable and prerelease (RC, beta, alpha).
 */
export async function fetchUmbracoVersions(): Promise<string[]> {
  const resp = await fetch(NUGET_INDEX_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return [];

  const data = (await resp.json()) as { versions: string[] };

  return data.versions
    .filter((v) => {
      const major = parseInt(v.split(".")[0], 10);
      return major >= 17;
    })
    .reverse();
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
