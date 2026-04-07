/**
 * Worker lifecycle helpers for chained MCP integration tests.
 *
 * Uses Wrangler's unstable_dev to boot the chained test worker.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, "../../../..");

let worker: Unstable_DevWorker | undefined;
let refCount = 0;

export async function startWorker(): Promise<Unstable_DevWorker> {
  if (worker) {
    refCount++;
    return worker;
  }

  worker = await unstable_dev(resolve(MONOREPO_ROOT, "tests/hosted-chained-mcp-e2e/worker/worker.ts"), {
    config: resolve(MONOREPO_ROOT, "tests/hosted-chained-mcp-e2e/wrangler.chaining.toml"),
    experimental: { disableExperimentalWarning: true },
    vars: {
      UMBRACO_BASE_URL: "https://localhost:5201",
      UMBRACO_SERVER_URL: "http://localhost:5200",
      UMBRACO_OAUTH_CLIENT_ID: "umbraco-back-office-hosted-mcp",
      UMBRACO_API_CLIENT_ID: "umbraco-back-office-mcp",
      UMBRACO_API_CLIENT_SECRET: "1234567890",
      COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ENABLE_INFO_ENDPOINT: "true",
      ENABLE_CONSENT_TOOL_SELECTION: "true",
    },
    logLevel: "error",
  });

  refCount = 1;
  return worker;
}

export async function stopWorker(): Promise<void> {
  refCount--;
  if (refCount <= 0 && worker) {
    await worker.stop();
    worker = undefined;
    refCount = 0;
  }
}

export async function workerFetch(
  pathOrUrl: string,
  init?: Parameters<Unstable_DevWorker["fetch"]>[1],
): Promise<Response> {
  if (!worker) {
    throw new Error("Worker not started. Call startWorker() first.");
  }
  return worker.fetch(pathOrUrl, init) as unknown as Response;
}
