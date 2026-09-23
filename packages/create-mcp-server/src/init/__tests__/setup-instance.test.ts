/**
 * resolveStarterKit / resolveExtraPackages tests.
 *
 * The kit version must track the CMS major via the kit's Umbraco dependency
 * (delegated to getLatestVersionByDependencyMajor), and we must fail loudly
 * rather than let PSW silently install a kit built for the wrong major.
 */

import { jest } from "@jest/globals";

const mockGetLatestVersionByDependencyMajor =
  jest.fn<
    (pkg: string, dep: string, major: number) => Promise<string | undefined>
  >();

const mockGetLatestPackageVersionForMajor = jest.fn<
  (
    pkg: string,
    major: number,
    opts?: {
      includePrerelease?: boolean;
      preferStableFallbackToPrerelease?: boolean;
    },
  ) => Promise<string | undefined>
>();

jest.unstable_mockModule("../nuget-versions.js", () => ({
  getLatestPackageVersionForMajor: mockGetLatestPackageVersionForMajor,
  getLatestVersionByDependencyMajor: mockGetLatestVersionByDependencyMajor,
  fetchNugetVersions: jest.fn(),
}));

const { resolveStarterKit, resolveExtraPackages } = await import("../setup-instance.js");

beforeEach(() => {
  mockGetLatestVersionByDependencyMajor.mockReset();
  mockGetLatestPackageVersionForMajor.mockReset();
});

describe("resolveStarterKit", () => {
  it("pins the kit to the version matching the CMS major", async () => {
    mockGetLatestVersionByDependencyMajor.mockResolvedValue("7.0.7");
    expect(await resolveStarterKit("clean", "17.4.2")).toBe("clean|7.0.7");
    expect(mockGetLatestVersionByDependencyMajor).toHaveBeenCalledWith(
      "clean",
      "Umbraco.Cms.Web.Website",
      17,
    );
  });

  it("pins to a prerelease kit when that is what targets the major (Umbraco 18 today)", async () => {
    mockGetLatestVersionByDependencyMajor.mockResolvedValue("8.0.0-rc1");
    expect(await resolveStarterKit("clean", "18.0.0")).toBe("clean|8.0.0-rc1");
  });

  it("throws when no kit version targets the CMS major (rather than mismatch)", async () => {
    mockGetLatestVersionByDependencyMajor.mockResolvedValue(undefined);
    await expect(resolveStarterKit("clean", "18.0.0")).rejects.toThrow(
      /No "clean" starter-kit version found targeting Umbraco 18/,
    );
  });

  it("returns the bare kit name when no CMS version is known (interactive default)", async () => {
    expect(await resolveStarterKit("clean", undefined)).toBe("clean");
    expect(mockGetLatestVersionByDependencyMajor).not.toHaveBeenCalled();
  });

  it("returns the bare kit name for an unparseable CMS version", async () => {
    expect(await resolveStarterKit("clean", "not-a-version")).toBe("clean");
  });
});

describe("resolveExtraPackages", () => {
  it("resolves both DevelopmentMode and Umbraco.Mcp.HostedAuth, matched to the CMS major", async () => {
    mockGetLatestPackageVersionForMajor.mockImplementation(async (pkg) =>
      pkg === "Umbraco.Cms.DevelopmentMode.Backoffice" ? "17.2.2" : "17.0.0-beta.3",
    );

    const packages = await resolveExtraPackages("17.4.2");

    expect(packages).toEqual([
      { name: "Umbraco.Cms.DevelopmentMode.Backoffice", version: "17.2.2" },
      { name: "Umbraco.Mcp.HostedAuth", version: "17.0.0-beta.3" },
    ]);
  });

  it("resolves Umbraco.Mcp.HostedAuth with stable-fallback-to-prerelease even for a stable CMS", async () => {
    mockGetLatestPackageVersionForMajor.mockResolvedValue(undefined);

    await resolveExtraPackages("17.4.2");

    expect(mockGetLatestPackageVersionForMajor).toHaveBeenCalledWith(
      "Umbraco.Mcp.HostedAuth",
      17,
      { includePrerelease: false, preferStableFallbackToPrerelease: true },
    );
    // DevelopmentMode has no such fallback — a stable CMS only accepts a stable version.
    expect(mockGetLatestPackageVersionForMajor).toHaveBeenCalledWith(
      "Umbraco.Cms.DevelopmentMode.Backoffice",
      17,
      { includePrerelease: false, preferStableFallbackToPrerelease: undefined },
    );
  });

  it("returns undefined versions when no Umbraco version is known (interactive default)", async () => {
    const packages = await resolveExtraPackages(undefined);
    expect(packages).toEqual([
      { name: "Umbraco.Cms.DevelopmentMode.Backoffice", version: undefined },
      { name: "Umbraco.Mcp.HostedAuth", version: undefined },
    ]);
    expect(mockGetLatestPackageVersionForMajor).not.toHaveBeenCalled();
  });
});
