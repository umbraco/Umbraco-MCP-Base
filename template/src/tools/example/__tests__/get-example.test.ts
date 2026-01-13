/**
 * Get Example Tool Tests (GET by ID)
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleBuilder,
  ExampleTestHelper,
} from "./setup.js";
import getExampleTool from "../get/get-example.js";

describe("get-example", () => {
  setupTestEnvironment();

  afterEach(async () => {
    await ExampleTestHelper.cleanup("Test");
  });

  it("should return item by ID", async () => {
    const context = createMockRequestHandlerExtra();

    // Create an item first
    const builder = await new ExampleBuilder()
      .withName("Test Get Item")
      .withDescription("Get test")
      .create();

    const result = await getExampleTool.handler(
      { id: builder.getId() },
      context
    );

    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.name).toBe("Test Get Item");
    expect(content.description).toBe("Get test");
  });

  it("should return error for non-existent ID", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await getExampleTool.handler(
      { id: "00000000-0000-0000-0000-000000000000" },
      context
    );

    expect(result.isError).toBe(true);
  });
});
