// Must be set before any TLS connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import "dotenv/config";
import https from "node:https";
import { initializeUmbracoFetch } from "@umbraco-cms/mcp-server-sdk";

// Directly configure the global HTTPS agent to accept self-signed certs
// (process.env alone isn't sufficient in Jest's VM module context)
https.globalAgent.options.rejectUnauthorized = false;

// Only override globalThis.fetch with undici when running against a real Umbraco instance.
// MSW intercepts via node:http — replacing fetch with undici bypasses MSW interception.
if (process.env.UMBRACO_BASE_URL && !process.env.USE_MOCK_API) {
  const { Agent, setGlobalDispatcher, fetch: undiciFetch } = await import("undici");
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  setGlobalDispatcher(agent);
  globalThis.fetch = undiciFetch as typeof globalThis.fetch;
}

// Initialize the SDK's fetch client with test credentials.
// MSW intercepts all HTTP requests in unit tests, so these don't need to be real.
// Without this, UmbracoManagementClient throws "not initialized" before MSW can intercept.
initializeUmbracoFetch({
  baseUrl: process.env.UMBRACO_BASE_URL || "http://localhost:9999",
  clientId: process.env.UMBRACO_CLIENT_ID || "test-client",
  clientSecret: process.env.UMBRACO_CLIENT_SECRET || "test-secret",
});
