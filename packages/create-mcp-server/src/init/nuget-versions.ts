/**
 * Fetch Umbraco CMS versions from NuGet.
 *
 * Used by both the version picker (prompts.ts) and E2E tests to resolve
 * available versions without duplicating the NuGet API call.
 *
 * The minimum major version is derived from this package's version
 * (e.g. 17.0.0-beta.8 → major 17) so it stays in sync automatically.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
const MIN_MAJOR = parseInt(pkg.version.split(".")[0], 10);

const NUGET_INDEX_URL =
  "https://api.nuget.org/v3-flatcontainer/umbraco.cms/index.json";

/**
 * Fetch Umbraco CMS versions from NuGet, newest first.
 * Filtered to the current major version and above.
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
      return major >= MIN_MAJOR;
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
