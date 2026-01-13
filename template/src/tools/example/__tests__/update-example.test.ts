/**
 * Update Example Tool Tests (PUT)
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleBuilder,
  ExampleTestHelper,
} from "./setup.js";
import updateExampleTool from "../put/update-example.js";

describe("update-example", () => {
  setupTestEnvironment();

  it("should update existing item", async () => {
    const context = createMockRequestHandlerExtra();

    // Create an item
    const builder = await new ExampleBuilder()
      .withName("Test Update Original")
      .withDescription("Original description")
      .create();

    // Update it
    const result = await updateExampleTool.handler(
      {
        id: builder.getId(),
        name: "Test Update Modified",
        description: "Modified description",
        isActive: false,
      },
      context
    );

    // executeVoidApiCall returns empty result on success
    expect(result.isError).toBeFalsy();

    // Verify the update
    const found = await ExampleTestHelper.findById(builder.getId());
    expect(found?.name).toBe("Test Update Modified");
    expect(found?.description).toBe("Modified description");
    expect(found?.isActive).toBe(false);
  });

  it("should return error for non-existent ID", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await updateExampleTool.handler(
      {
        id: "00000000-0000-0000-0000-000000000000",
        name: "Test Update",
        description: null,
        isActive: true,
      },
      context
    );

    expect(result.isError).toBe(true);
  });
});
