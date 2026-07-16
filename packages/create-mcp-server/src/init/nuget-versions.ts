/**
 * Fetch Umbraco CMS versions from NuGet.
 *
 * Used by both the version picker (prompts.ts) and E2E tests to resolve
 * available versions without duplicating the NuGet API call.
 *
 * The minimum major version is derived from this package's version
 * (e.g. 17.0.0-beta.8 → major 17) so it stays in sync automatically.
 */

// Minimum Umbraco major version this tool supports (17 LTS). Kept independent of
// this package's own version — the SDK/tooling versions on its own line and no
// longer tracks the Umbraco major.
const MIN_MAJOR = 17;

// Transient NuGet failures (5xx, 429, request timeout, network blips) are retried
// with exponential backoff. Without this, a single hiccup returns an empty list
// that reads as "no versions exist" — which is exactly how one flaky request once
// failed the whole Umbraco-18 leg of the scheduled E2E check with a misleading
// "No Umbraco 18.x version found on NuGet".
const NUGET_RETRY_ATTEMPTS = 3;
const NUGET_RETRY_BASE_MS = 250;

/** HTTP statuses worth retrying — the server is up but the request didn't stick. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Fetch a NuGet URL, retrying transient failures with exponential backoff.
 *
 * Non-transient responses (2xx, 404, ...) are returned as-is for the caller to
 * interpret. Throws only once every attempt has failed with a transient error
 * or network fault, so callers can tell "NuGet was unreachable" apart from a
 * legitimate empty/absent result.
 */
async function fetchNuget(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < NUGET_RETRY_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!isTransientStatus(resp.status)) return resp;
      lastError = new Error(`NuGet returned HTTP ${resp.status} for ${url}`);
    } catch (err) {
      lastError = err; // network error or request timeout
    }
    if (attempt < NUGET_RETRY_ATTEMPTS - 1) {
      const backoff = NUGET_RETRY_BASE_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw new Error(
    `NuGet request failed after ${NUGET_RETRY_ATTEMPTS} attempts: ${url}`,
    { cause: lastError },
  );
}

/**
 * Fetch all published versions of any NuGet package, newest first.
 * Includes stable and prerelease (RC, beta, alpha).
 *
 * Retries transient failures (see {@link fetchNuget}); throws if NuGet stays
 * unreachable across every attempt. Returns [] only for a genuine non-OK
 * response such as 404 (the package has no published versions).
 */
export async function fetchNugetVersions(packageId: string): Promise<string[]> {
  const url = `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/index.json`;
  const resp = await fetchNuget(url);
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
    return await getLatestVersionForMajorStrict(major, opts);
  } catch {
    return undefined;
  }
}

/**
 * Like {@link getLatestVersionForMajor} but propagates NuGet request failures
 * instead of swallowing them to `undefined`.
 *
 * Lets a caller distinguish "NuGet was unreachable" (throws) from "no such
 * version exists" (resolves to `undefined`) — two cases the lenient variant
 * collapses together. Used by the scheduled E2E resolve step so a transient
 * NuGet outage surfaces as an outage rather than a phantom "no version found".
 */
export async function getLatestVersionForMajorStrict(
  major: number,
  opts: { includePrerelease?: boolean } = {},
): Promise<string | undefined> {
  const versions = await fetchUmbracoVersions();
  return pickLatestForMajor(versions, major, opts);
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

/**
 * Pick the newest version of a package whose dependency on `dependencyId`
 * targets `major`, preferring stable and falling back to the newest prerelease.
 *
 * This is how a starter kit (e.g. "clean") is matched to the CMS major. Unlike an
 * add-on, a kit's own version does NOT track the CMS major (clean 7.x → Umbraco
 * 17, 8.x → 18), so `getLatestPackageVersionForMajor` can't be used — we match on
 * what Umbraco the kit *depends on* instead, read from NuGet's registration index.
 * Preferring stable but falling back to prerelease keeps both matrix legs green
 * even while a major has no stable kit yet: for Umbraco 18 today this yields the
 * latest clean 8.x prerelease (no stable 8.x exists), and for 17 the latest stable
 * 7.x. When a stable clean 8.x ships it is picked automatically.
 *
 * Returns undefined when NuGet is unreachable or no version targets the major.
 */
export async function getLatestVersionByDependencyMajor(
  packageId: string,
  dependencyId: string,
  major: number,
): Promise<string | undefined> {
  try {
    const [versions, depMajors] = await Promise.all([
      fetchNugetVersions(packageId), // newest-first
      fetchDependencyMajors(packageId, dependencyId),
    ]);
    const matching = versions.filter((v) => depMajors.get(v) === major);
    // matching is newest-first: prefer the newest stable, else newest prerelease.
    return matching.find((v) => !v.includes("-")) ?? matching[0];
  } catch {
    return undefined;
  }
}

interface RegistrationIndex {
  items?: RegistrationPage[];
}
interface RegistrationPage {
  "@id"?: string;
  items?: RegistrationLeaf[];
}
interface RegistrationLeaf {
  catalogEntry: CatalogEntry;
}
interface CatalogEntry {
  version: string;
  dependencyGroups?: Array<{
    dependencies?: Array<{ id: string; range?: string }>;
  }>;
}

/**
 * Map each published version of `packageId` to the lower-bound major of its
 * declared dependency on `dependencyId`, read from NuGet's registration index.
 * Returns an empty map on any error (caller then finds no match).
 */
async function fetchDependencyMajors(
  packageId: string,
  dependencyId: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const url = `https://api.nuget.org/v3/registration5-gz-semver2/${packageId.toLowerCase()}/index.json`;
  const resp = await fetchNuget(url);
  if (!resp.ok) return result;

  const data = (await resp.json()) as RegistrationIndex;
  for (const page of data.items ?? []) {
    let leaves = page.items;
    // Large packages page their registration: a page may omit inline items and
    // expose them via its own @id. Starter kits are small (single inline page),
    // but fetch sub-pages defensively so this stays correct for any package.
    if (!leaves && page["@id"]) {
      const pageResp = await fetchNuget(page["@id"]);
      if (pageResp.ok) leaves = ((await pageResp.json()) as RegistrationPage).items;
    }
    for (const leaf of leaves ?? []) {
      const major = dependencyMajor(leaf.catalogEntry, dependencyId);
      if (major !== undefined) result.set(leaf.catalogEntry.version, major);
    }
  }
  return result;
}

/** Read the lower-bound major of a catalog entry's dependency on `dependencyId`. */
function dependencyMajor(
  cat: CatalogEntry,
  dependencyId: string,
): number | undefined {
  for (const group of cat.dependencyGroups ?? []) {
    for (const dep of group.dependencies ?? []) {
      if (dep.id.toLowerCase() !== dependencyId.toLowerCase()) continue;
      // range like "[18.0.0-beta2, )" or "17.1.0" — first integer is the major.
      const match = /\d+/.exec(dep.range ?? "");
      if (match) return parseInt(match[0], 10);
    }
  }
  return undefined;
}
