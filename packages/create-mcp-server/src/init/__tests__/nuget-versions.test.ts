import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  getLatestStableVersion,
  getLatestVersionForMajor,
} from "../nuget-versions.js";

// NuGet flatcontainer returns versions oldest-first; fetchUmbracoVersions
// filters to >= the package major (17) and reverses to newest-first.
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

  it("ignores versions below the package major (filtered upstream)", async () => {
    mockNuget(NUGET_VERSIONS);
    expect(await getLatestVersionForMajor(16)).toBeUndefined();
  });

  it("still resolves the overall latest stable", async () => {
    mockNuget(NUGET_VERSIONS);
    expect(await getLatestStableVersion()).toBe("17.4.2");
  });
});
