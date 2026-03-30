// Must be set before any TLS connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import "dotenv/config";
import https from "node:https";
import { Agent, setGlobalDispatcher, fetch as undiciFetch } from "undici";

// Directly configure the global HTTPS agent to accept self-signed certs
// (process.env alone isn't sufficient in Jest's VM module context)
https.globalAgent.options.rejectUnauthorized = false;

// Node.js 22's built-in fetch (internal undici) ignores NODE_TLS_REJECT_UNAUTHORIZED
// and https.globalAgent inside Jest's --experimental-vm-modules sandbox.
// Override globalThis.fetch with the npm undici's fetch which respects our dispatcher.
const agent = new Agent({ connect: { rejectUnauthorized: false } });
setGlobalDispatcher(agent);
globalThis.fetch = undiciFetch as typeof globalThis.fetch;
