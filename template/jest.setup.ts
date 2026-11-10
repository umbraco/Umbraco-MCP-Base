import "./src/load-env.js";
import https from "node:https";
import { initializeUmbracoFetch, isLoopbackUrl } from "@umbraco-cms/mcp-server-sdk";

const baseUrl = process.env.UMBRACO_BASE_URL || "http://localhost:9999";

// Accept the local instance's self-signed certificate. Local only: the SDK
// refuses to start with NODE_TLS_REJECT_UNAUTHORIZED=0 and a remote base URL.
const isLocal = isLoopbackUrl(baseUrl);
if (isLocal) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  // process.env alone isn't sufficient in Jest's VM module context
  https.globalAgent.options.rejectUnauthorized = false;
}

// Only override globalThis.fetch with undici when running against a real Umbraco instance.
// MSW intercepts via node:http — replacing fetch with undici bypasses MSW interception.
if (process.env.UMBRACO_BASE_URL && !process.env.USE_MOCK_API) {
  const { Agent, setGlobalDispatcher, fetch: undiciFetch } = await import("undici");
  const agent = new Agent({ connect: { rejectUnauthorized: !isLocal } });
  setGlobalDispatcher(agent);
  globalThis.fetch = undiciFetch as typeof globalThis.fetch;
}

// Initialize the SDK's fetch client with test credentials.
// MSW intercepts all HTTP requests in unit tests, so these don't need to be real.
// Without this, UmbracoManagementClient throws "not initialized" before MSW can intercept.
initializeUmbracoFetch({
  baseUrl,
  clientId: process.env.UMBRACO_CLIENT_ID || "test-client",
  clientSecret: process.env.UMBRACO_CLIENT_SECRET || "test-secret",
});
