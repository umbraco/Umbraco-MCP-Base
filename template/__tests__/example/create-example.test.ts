/**
 * Create Example Tool Test
 *
 * Tests the create-example tool using the mock API client.
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
} from "@umbraco-cms/mcp-toolkit/testing";
import { configureApiClient } from "@umbraco-cms/mcp-toolkit";
import { getExampleUmbracoAddOnAPI } from "../../src/api/generated/exampleApi.js";
import createExampleTool from "../../src/tools/example/post/create-example.js";

// Enable mock mode for tests
process.env.USE_MOCK_API = "true";

// Configure the API client for the helpers
configureApiClient(() => getExampleUmbracoAddOnAPI());

describe("create-example", () => {
  setupTestEnvironment();

  it("should create a new item", async () => {
    // Arrange
    const context = createMockRequestHandlerExtra();

    // Act
    const result = await createExampleTool.handler(
      { name: "New Item", description: "New description", isActive: true },
      context
    );

    // Assert
    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
    expect(content.id).toBeDefined();
    expect(content.location).toBeDefined();
    expect(content.location).toContain(content.id);
  });

  it("should reject reserved names", async () => {
    // Arrange
    const context = createMockRequestHandlerExtra();

    // Act
    const result = await createExampleTool.handler(
      { name: "_reserved_name" },
      context
    );

    // Assert - should have error response due to ToolValidationError
    expect(result.isError).toBe(true);
  });

  it("should handle optional fields", async () => {
    // Arrange
    const context = createMockRequestHandlerExtra();

    // Act - only name is required, others are optional
    const result = await createExampleTool.handler(
      { name: "Item without description", isActive: true },
      context
    );

    // Assert
    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
    expect(content.id).toBeDefined();
  });
});
