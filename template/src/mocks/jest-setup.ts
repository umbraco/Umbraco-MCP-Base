/**
 * Jest Global Setup for MSW
 *
 * This file is loaded by Jest's setupFilesAfterEnv configuration.
 * MSW is only started when USE_MOCK_API=true. This is set in this repo's
 * monorepo jest setup but NOT in scaffolded projects — scaffolded sites
 * run tests against a real Umbraco instance by default.
 */

import { setupMswServer } from "@umbraco-cms/mcp-server-sdk/testing";
import { server } from "./server.js";
import { resetStore } from "./store.js";

if (process.env.USE_MOCK_API === "true") {
  setupMswServer(server, resetStore);
}
