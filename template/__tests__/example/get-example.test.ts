/**
 * Get Example Tool Test
 *
 * Tests the get-example tool using the mock API client.
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
} from "@umbraco-cms/mcp-toolkit/testing";
import { configureApiClient } from "@umbraco-cms/mcp-toolkit";
import { getExampleUmbracoAddOnAPI } from "../../src/api/generated/exampleApi.js";
import getExampleTool from "../../src/tools/example/get/get-example.js";
import createExampleTool from "../../src/tools/example/post/create-example.js";

// Enable mock mode for tests
process.env.USE_MOCK_API = "true";

// Configure the API client for the helpers
configureApiClient(() => getExampleUmbracoAddOnAPI());

describe("get-example", () => {
  setupTestEnvironment();

  it("should return example item by ID", async () => {
    // Arrange - create an item first
    const context = createMockRequestHandlerExtra();
    const createResult = await createExampleTool.handler(
      { name: "Test Item", description: "Test description" },
      context
    );
    const createdId = (createResult.structuredContent as any)?.id;
    expect(createdId).toBeDefined();

    // Act - get the created item
    const result = await getExampleTool.handler(
      { id: createdId },
      context
    );

    // Assert
    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.id).toBe(createdId);
    expect(content.name).toBe("Test Item");
    expect(content.description).toBe("Test description");
    expect(content.createdAt).toBeDefined();
    expect(content.updatedAt).toBeDefined();
  });

  it("should return error for non-existent item", async () => {
    // Arrange
    const context = createMockRequestHandlerExtra();
    const nonExistentId = "00000000-0000-0000-0000-000000000000";

    // Act
    const result = await getExampleTool.handler(
      { id: nonExistentId },
      context
    );

    // Assert - should have error content
    expect(result.isError).toBe(true);
  });
});
