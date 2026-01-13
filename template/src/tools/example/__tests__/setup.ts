/**
 * Shared test setup for example tools
 *
 * MSW server is configured globally via jest.config.ts setupFilesAfterEnv.
 * See src/mocks/jest-setup.ts for the global MSW setup.
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
} from "@umbraco-cms/mcp-toolkit/testing";
import { configureApiClient } from "@umbraco-cms/mcp-toolkit";
import { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { server } from "../../../mocks/server.js";
import { ExampleBuilder } from "./helpers/example-builder.js";
import { ExampleTestHelper } from "./helpers/example-test-helper.js";

configureApiClient(() => getExampleUmbracoAddOnAPI());

export {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleBuilder,
  ExampleTestHelper,
  server,
};
