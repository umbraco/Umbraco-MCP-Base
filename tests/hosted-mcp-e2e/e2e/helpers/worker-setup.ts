/**
 * Worker lifecycle for E2E tests.
 *
 * Starts and stops the Worker using Wrangler's unstable_dev.
 */

import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker | undefined;
let workerUrl: string | undefined;

export async function startWorker(): Promise<string> {
  worker = await unstable_dev("template/src/worker.ts", {
    config: "tests/hosted-mcp-e2e/wrangler.integration.toml",
    port: 8787,
    experimental: { disableExperimentalWarning: true },
    vars: {
      UMBRACO_BASE_URL: "https://localhost:5201",
      UMBRACO_SERVER_URL: "http://localhost:5200",
      UMBRACO_OAUTH_CLIENT_ID: "umbraco-back-office-mcp",
      COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ENABLE_INFO_ENDPOINT: "true",
    },
  });

  // unstable_dev provides address and port
  const address = worker.address;
  const port = worker.port;
  workerUrl = `http://${address}:${port}`;
  return workerUrl;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.stop();
    worker = undefined;
    workerUrl = undefined;
  }
}

export function getWorkerUrl(): string {
  if (!workerUrl) {
    throw new Error("Worker not started. Call startWorker() first.");
  }
  return workerUrl;
}
