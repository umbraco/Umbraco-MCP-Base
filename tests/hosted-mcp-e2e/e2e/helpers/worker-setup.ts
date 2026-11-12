/**
 * Worker lifecycle for E2E tests.
 *
 * Starts and stops the Worker using Wrangler's unstable_dev.
 */

import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker | undefined;
let workerUrl: string | undefined;

// In CI the Umbraco instance is reached over HTTP to avoid its self-signed
// cert in server-side calls. The Worker itself is served over https; its
// redirect_uri (https://127.0.0.1:8787/callback) matches an origin registered
// for this client id in tests/umbraco-instance's HostedMcp:Clients config
// (Umbraco.Mcp.HostedAuth).
const BASE_VARS = {
  UMBRACO_BASE_URL: process.env.CI ? "http://localhost:5200" : "https://localhost:5201",
  UMBRACO_SERVER_URL: "http://localhost:5200",
  UMBRACO_OAUTH_CLIENT_ID: "umbraco-back-office-hosted-mcp",
  COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ENABLE_INFO_ENDPOINT: "true",
};

export async function startWorker(varsOverride?: Record<string, string>): Promise<string> {
  worker = await unstable_dev("template/src/worker.ts", {
    config: "tests/hosted-mcp-e2e/wrangler.integration.toml",
    port: 8787,
    // Serve over https (self-signed) so the sign-in flow matches production:
    // __Host- cookies, Secure, and https redirect URIs.
    localProtocol: "https",
    experimental: { disableExperimentalWarning: true },
    vars: { ...BASE_VARS, ...varsOverride },
    logLevel: "error",
  });

  const address = worker.address;
  const port = worker.port;
  workerUrl = `https://${address}:${port}`;
  return workerUrl;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.stop();
    worker = undefined;
    workerUrl = undefined;
    // Give workerd time to release ports
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function getWorkerUrl(): string {
  if (!workerUrl) {
    throw new Error("Worker not started. Call startWorker() first.");
  }
  return workerUrl;
}
