/**
 * Delete Example Tool Tests (DELETE)
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleBuilder,
  ExampleTestHelper,
} from "./setup.js";
import deleteExampleTool from "../delete/delete-example.js";

describe("delete-example", () => {
  setupTestEnvironment();

  it("should delete existing item", async () => {
    const context = createMockRequestHandlerExtra();

    // Create an item
    const builder = await new ExampleBuilder()
      .withName("Test Delete Item")
      .create();
    const id = builder.getId();

    // Verify it exists
    const before = await ExampleTestHelper.findById(id);
    expect(before).toBeDefined();

    // Delete it
    const result = await deleteExampleTool.handler({ id }, context);

    // executeVoidApiCall returns empty result on success
    expect(result.isError).toBeFalsy();

    // Verify it's gone
    const after = await ExampleTestHelper.findById(id);
    expect(after).toBeUndefined();
  });

  it("should return error for non-existent ID", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await deleteExampleTool.handler(
      { id: "00000000-0000-0000-0000-000000000000" },
      context
    );

    expect(result.isError).toBe(true);
  });
});
