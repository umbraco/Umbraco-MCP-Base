/**
 * Worker lifecycle for E2E tests.
 *
 * Starts and stops the Worker using Wrangler's unstable_dev.
 */

import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker | undefined;
let workerUrl: string | undefined;

const BASE_VARS = {
  UMBRACO_BASE_URL: "https://localhost:5201",
  UMBRACO_SERVER_URL: "http://localhost:5200",
  UMBRACO_OAUTH_CLIENT_ID: "umbraco-back-office-mcp",
  COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ENABLE_INFO_ENDPOINT: "true",
};

export async function startWorker(varsOverride?: Record<string, string>): Promise<string> {
  worker = await unstable_dev("src/worker.ts", {
    config: "tests/hosted-e2e/wrangler.e2e.toml",
    port: 8787,
    experimental: { disableExperimentalWarning: true },
    vars: { ...BASE_VARS, ...varsOverride },
    logLevel: "error",
  });

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
