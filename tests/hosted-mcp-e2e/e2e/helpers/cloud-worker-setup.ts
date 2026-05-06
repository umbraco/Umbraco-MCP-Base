/**
 * Cloud-routing worker lifecycle for E2E tests.
 *
 * Boots `tests/hosted-mcp-e2e/cloud-worker/worker.ts` via `unstable_dev`,
 * configured with `umbracoCloudSiteRouting`. Used by the Cloud E2E test
 * that authenticates against a real Umbraco Cloud project.
 */

import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker | undefined;
let workerUrl: string | undefined;

export interface StartCloudWorkerOptions {
  oauthClientId: string;
  region?: string;
}

export async function startCloudWorker(
  options: StartCloudWorkerOptions,
): Promise<string> {
  worker = await unstable_dev("tests/hosted-mcp-e2e/cloud-worker/worker.ts", {
    config: "tests/hosted-mcp-e2e/cloud-worker/wrangler.toml",
    port: 8787,
    experimental: { disableExperimentalWarning: true },
    vars: {
      // The cloud-worker reads UMBRACO_CLOUD_OAUTH_CLIENT_ID at request time
      // and feeds it into the umbracoCloudSiteRouting preset.
      UMBRACO_CLOUD_OAUTH_CLIENT_ID: options.oauthClientId,
      UMBRACO_CLOUD_REGION: options.region ?? "euwest01",
      // Cookie key only needs to be a valid 32-byte hex string for the test.
      COOKIE_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      // UMBRACO_BASE_URL is unused when siteRouting is active, but is required
      // by the env interface — set to a placeholder.
      UMBRACO_BASE_URL: "https://placeholder.invalid",
      ENABLE_INFO_ENDPOINT: "true",
    },
    logLevel: "error",
  });

  const address = worker.address;
  const port = worker.port;
  workerUrl = `http://${address}:${port}`;
  return workerUrl;
}

export async function stopCloudWorker(): Promise<void> {
  if (worker) {
    await worker.stop();
    worker = undefined;
    workerUrl = undefined;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function getCloudWorkerUrl(): string {
  if (!workerUrl) {
    throw new Error("Cloud worker not started. Call startCloudWorker() first.");
  }
  return workerUrl;
}
