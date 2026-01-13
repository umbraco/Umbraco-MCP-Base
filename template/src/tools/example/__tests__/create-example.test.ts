/**
 * Create Example Tool Tests (POST)
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleTestHelper,
} from "./setup.js";
import createExampleTool from "../post/create-example.js";

describe("create-example", () => {
  setupTestEnvironment();

  afterEach(async () => {
    await ExampleTestHelper.cleanup("Test");
    await ExampleTestHelper.cleanup("_reserved_");
  });

  it("should create a new item", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await createExampleTool.handler(
      { name: "Test Item", description: "Test description", isActive: true },
      context
    );

    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
    expect(content.id).toBeDefined();

    // Verify item was created
    const found = await ExampleTestHelper.findById(content.id);
    expect(found?.name).toBe("Test Item");
  });

  it("should reject reserved names", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await createExampleTool.handler(
      { name: "_reserved_name", description: null, isActive: true },
      context
    );

    expect(result.isError).toBe(true);
  });

  it("should handle optional fields", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await createExampleTool.handler(
      { name: "Test Minimal", description: null, isActive: true },
      context
    );

    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
  });
});
