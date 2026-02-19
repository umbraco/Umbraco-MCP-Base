const MARKETPLACE_API =
  "https://api.marketplace.umbraco.com/api/v1/packages";

export interface Package {
  packageId: string;
  version: string;
  source: string;
}

export interface ListPackagesOptions {
  hqOnly?: boolean;
  searchText?: string;
}

export async function listPackages(
  opts: ListPackagesOptions = {}
): Promise<Package[]> {
  const params = new URLSearchParams({
    packageType: "Package",
    pageSize: "20",
    orderBy: "PopularityScore",
  });

  if (opts.hqOnly) {
    params.set("hQOnly", "true");
  }

  if (opts.searchText) {
    params.set("text", opts.searchText);
  }

  const url = `${MARKETPLACE_API}?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Marketplace API error: ${response.status}`);
  }

  const data = await response.json();

  return data.results.map(
    (pkg: { packageId: string; latestVersionNumber: string; packageSource: string }) => ({
      packageId: pkg.packageId,
      version: pkg.latestVersionNumber,
      source: pkg.packageSource,
    })
  );
}
