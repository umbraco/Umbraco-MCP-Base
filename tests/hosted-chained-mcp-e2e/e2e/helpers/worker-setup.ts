/**
 * Worker lifecycle for chained MCP E2E tests.
 *
 * Starts the chained test worker (template collections + demo chained MCP).
 */

import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker | undefined;
let workerUrl: string | undefined;

const BASE_VARS = {
  UMBRACO_BASE_URL: "https://localhost:5201",
  UMBRACO_SERVER_URL: "http://localhost:5200",
  UMBRACO_OAUTH_CLIENT_ID: "umbraco-back-office-mcp",
  UMBRACO_API_CLIENT_ID: "umbraco-back-office-mcp",
  UMBRACO_API_CLIENT_SECRET: "1234567890",
  COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ENABLE_INFO_ENDPOINT: "true",
  ENABLE_CONSENT_TOOL_SELECTION: "true",
};

export async function startWorker(varsOverride?: Record<string, string>): Promise<string> {
  worker = await unstable_dev("tests/hosted-chained-mcp-e2e/worker/worker.ts", {
    config: "tests/hosted-chained-mcp-e2e/wrangler.chaining.toml",
    port: 8788,
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
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function getWorkerUrl(): string {
  if (!workerUrl) {
    throw new Error("Worker not started. Call startWorker() first.");
  }
  return workerUrl;
}
