/**
 * Worker lifecycle helpers for integration tests.
 *
 * Uses Wrangler's unstable_dev to boot the template Worker
 * with full virtual module resolution (agents/mcp, OAuth provider).
 *
 * The Worker is started once and reused across test files (since tests
 * run in band with --runInBand). Call startWorker() in each test's
 * beforeAll — it will reuse the existing instance if already running.
 */

import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker | undefined;
let refCount = 0;

/**
 * Start the Worker using the integration test config.
 * If the Worker is already running, reuses the existing instance.
 * Resolves when the Worker is ready to accept requests.
 */
export async function startWorker(): Promise<Unstable_DevWorker> {
  if (worker) {
    refCount++;
    return worker;
  }

  worker = await unstable_dev("src/worker.ts", {
    config: "wrangler.integration.toml",
    experimental: { disableExperimentalWarning: true },
    vars: {
      UMBRACO_BASE_URL: "https://localhost:5201",
      UMBRACO_SERVER_URL: "http://localhost:5200",
      UMBRACO_OAUTH_CLIENT_ID: "umbraco-back-office-mcp",
      COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ENABLE_INFO_ENDPOINT: "true",
    },
  });

  refCount = 1;
  return worker;
}

/**
 * Stop the Worker and clean up resources.
 * Only actually stops when the last reference is released.
 */
export async function stopWorker(): Promise<void> {
  refCount--;
  if (refCount <= 0 && worker) {
    await worker.stop();
    worker = undefined;
    refCount = 0;
  }
}

/**
 * Make a fetch request to the running Worker.
 * Uses worker.fetch() for reliable local dispatch.
 */
export async function workerFetch(
  pathOrUrl: string,
  init?: RequestInit,
): Promise<Response> {
  if (!worker) {
    throw new Error("Worker not started. Call startWorker() first.");
  }
  return worker.fetch(pathOrUrl, init) as unknown as Response;
}
