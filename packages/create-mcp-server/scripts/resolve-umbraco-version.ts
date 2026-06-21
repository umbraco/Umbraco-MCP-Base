/**
 * Print the latest Umbraco version for a given major to stdout.
 *
 * Used by the scheduled E2E workflow to pin each matrix leg to a major
 * (e.g. 17 LTS, 18) without hardcoding a version string that rots.
 *
 *   npx tsx scripts/resolve-umbraco-version.ts 17
 *   npx tsx scripts/resolve-umbraco-version.ts 18 --prerelease
 */
import { getLatestVersionForMajor } from "../src/init/nuget-versions.js";

const major = parseInt(process.argv[2] ?? "", 10);
if (Number.isNaN(major)) {
  console.error("Usage: resolve-umbraco-version.ts <major> [--prerelease]");
  process.exit(2);
}

const includePrerelease = process.argv.includes("--prerelease");

const version = await getLatestVersionForMajor(major, { includePrerelease });
if (!version) {
  console.error(
    `No Umbraco ${major}.x version found on NuGet (includePrerelease=${includePrerelease})`,
  );
  process.exit(1);
}

process.stdout.write(version);
