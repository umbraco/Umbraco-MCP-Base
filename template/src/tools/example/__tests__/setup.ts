/**
 * Shared test setup for example tools
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
} from "@umbraco-cms/mcp-toolkit/testing";
import { configureApiClient } from "@umbraco-cms/mcp-toolkit";
import { getExampleUmbracoAddOnAPI } from "../../../api/generated/exampleApi.js";
import { ExampleBuilder } from "./helpers/example-builder.js";
import { ExampleTestHelper } from "./helpers/example-test-helper.js";

process.env.USE_MOCK_API = "true";
configureApiClient(() => getExampleUmbracoAddOnAPI());

export {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleBuilder,
  ExampleTestHelper,
};
