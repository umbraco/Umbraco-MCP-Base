/**
 * Jest Global Setup for MSW
 *
 * This file is loaded by Jest's setupFilesAfterEnv configuration.
 * It sets up MSW server globally so it only starts once for all tests.
 */

import { setupMswServer } from "@umbraco-cms/mcp-toolkit/testing";
import { server } from "./server.js";
import { resetStore } from "./store.js";

setupMswServer(server, resetStore);
