/**
 * Jest Global Setup for MSW
 *
 * This file is loaded by Jest's setupFilesAfterEnv configuration.
 * MSW intercepts all HTTP requests so unit tests don't need a running
 * Umbraco instance. The mock store is reset between tests.
 */

import { setupMswServer } from "@umbraco-cms/mcp-server-sdk/testing";
import { server } from "./server.js";
import { resetStore } from "./store.js";

setupMswServer(server, resetStore);
