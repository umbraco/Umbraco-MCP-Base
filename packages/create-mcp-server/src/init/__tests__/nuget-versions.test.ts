import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  fetchNugetVersions,
  getLatestStableVersion,
  getLatestVersionForMajor,
  getLatestVersionForMajorStrict,
  getLatestVersionByDependencyMajor,
} from "../nuget-versions.js";

// NuGet flatcontainer returns versions oldest-first; fetchUmbracoVersions
// filters to >= the supported Umbraco floor (17) and reverses to newest-first.
const NUGET_VERSIONS = [
  "16.2.0",
  "17.0.0",
  "17.4.2",
  "18.0.0-rc1",
  "18.0.0-rc2",
];

let originalFetch: typeof globalThis.fetch;

function mockNuget(versions: string[]) {
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ versions }),
  })) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getLatestVersionForMajor", () => {
  it("returns the latest stable for a major, excluding prereleases by default", async () => {
    mockNuget(NUGET_VERSIONS);
    expect(await getLatestVersionForMajor(17)).toBe("17.4.2");
  });

  it("returns the latest prerelease when includePrerelease is set", async () => {
    mockNuget(NUGET_VERSIONS);
    expect(await getLatestVersionForMajor(18, { includePrerelease: true })).toBe(
      "18.0.0-rc2",
    );
  });

  it("returns undefined for a major that only has prereleases when they are excluded", async () => {
    mockNuget(NUGET_VERSIONS);
    expect(await getLatestVersionForMajor(18)).toBeUndefined();
  });

  it("ignores versions below the supported Umbraco floor (filtered upstream)", async () => {
    mockNuget(NUGET_VERSIONS);
    expect(await getLatestVersionForMajor(16)).toBeUndefined();
  });

  it("still resolves the overall latest stable", async () => {
    mockNuget(NUGET_VERSIONS);
    expect(await getLatestStableVersion()).toBe("17.4.2");
  });
});

describe("transient NuGet failures", () => {
  // A response whose status marks it retryable (server up, request didn't stick).
  const transient = () => ({ ok: false, status: 503, json: async () => ({}) });
  const success = (versions: string[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ versions }),
  });

  it("retries a transient failure and then succeeds", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(transient())
      .mockResolvedValueOnce(transient())
      .mockResolvedValueOnce(success(NUGET_VERSIONS));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    expect(await getLatestVersionForMajor(17)).toBe("17.4.2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("getLatestVersionForMajor swallows an exhausted outage to undefined", async () => {
    globalThis.fetch = jest.fn(async () =>
      transient(),
    ) as unknown as typeof globalThis.fetch;
    expect(await getLatestVersionForMajor(17)).toBeUndefined();
  });

  it("getLatestVersionForMajorStrict throws when NuGet stays unreachable", async () => {
    const fetchMock = jest.fn(async () => transient());
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(getLatestVersionForMajorStrict(17)).rejects.toThrow(/failed after/i);
    // Three attempts, no more (backoff between them, not after the last).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-transient 404 (package has no versions)", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    expect(await fetchNugetVersions("does.not.exist")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getLatestVersionByDependencyMajor", () => {
  // Mirrors the real "clean" starter kit: its own version (7.x/8.x) tracks the
  // CMS major only via its Umbraco.Cms.Web.Website dependency, not its own number.
  const KIT_VERSIONS = [
    "7.0.6",
    "7.0.7",
    "8.0.0-beta01",
    "8.0.0-rc1",
  ];
  const KIT_DEP_MAJOR: Record<string, number> = {
    "7.0.6": 17,
    "7.0.7": 17,
    "8.0.0-beta01": 18,
    "8.0.0-rc1": 18,
  };

  /**
   * Mock both NuGet endpoints the resolver hits: the flatcontainer version index
   * (oldest-first) and the gz-semver2 registration index (dependency ranges).
   */
  function mockKitNuget(
    versions: string[],
    depMajor: Record<string, number>,
  ) {
    globalThis.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("flatcontainer")) {
        return { ok: true, json: async () => ({ versions }) };
      }
      // registration index: one inline page of leaves with dependency groups
      const items = versions.map((v) => ({
        catalogEntry: {
          version: v,
          dependencyGroups: [
            {
              dependencies: [
                {
                  id: "Umbraco.Cms.Web.Website",
                  range: `[${depMajor[v]}.0.0, )`,
                },
              ],
            },
          ],
        },
      }));
      return { ok: true, json: async () => ({ items: [{ items }] }) };
    }) as unknown as typeof globalThis.fetch;
  }

  it("picks the latest stable kit whose Umbraco dependency matches the major", async () => {
    mockKitNuget(KIT_VERSIONS, KIT_DEP_MAJOR);
    expect(
      await getLatestVersionByDependencyMajor("clean", "Umbraco.Cms.Web.Website", 17),
    ).toBe("7.0.7");
  });

  it("falls back to the newest prerelease when a major has no stable kit", async () => {
    mockKitNuget(KIT_VERSIONS, KIT_DEP_MAJOR);
    expect(
      await getLatestVersionByDependencyMajor("clean", "Umbraco.Cms.Web.Website", 18),
    ).toBe("8.0.0-rc1");
  });

  it("prefers a stable kit over a newer prerelease of the same major", async () => {
    // 8.0.1-rc1 is newer than the 8.0.0 stable, but stable wins for its major.
    const versions = ["8.0.0", "8.0.1-rc1"];
    mockKitNuget(versions, { "8.0.0": 18, "8.0.1-rc1": 18 });
    expect(
      await getLatestVersionByDependencyMajor("clean", "Umbraco.Cms.Web.Website", 18),
    ).toBe("8.0.0");
  });

  it("returns undefined when no kit version targets the major", async () => {
    mockKitNuget(KIT_VERSIONS, KIT_DEP_MAJOR);
    expect(
      await getLatestVersionByDependencyMajor("clean", "Umbraco.Cms.Web.Website", 99),
    ).toBeUndefined();
  });

  it("returns undefined when NuGet is unreachable", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    expect(
      await getLatestVersionByDependencyMajor("clean", "Umbraco.Cms.Web.Website", 18),
    ).toBeUndefined();
  });
});
