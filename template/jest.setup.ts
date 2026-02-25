// Must be set before any TLS connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import "dotenv/config";
import https from "node:https";

// Directly configure the global HTTPS agent to accept self-signed certs
// (process.env alone isn't sufficient in Jest's VM module context)
https.globalAgent.options.rejectUnauthorized = false;
