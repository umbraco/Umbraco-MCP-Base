/**
 * Search Examples Tool Tests (GET search)
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleBuilder,
  ExampleTestHelper,
} from "./setup.js";
import searchExamplesTool from "../get/search-examples.js";

describe("search-examples", () => {
  setupTestEnvironment();

  beforeEach(async () => {
    await new ExampleBuilder()
      .withName("Test Search Alpha")
      .withDescription("First item")
      .create();
    await new ExampleBuilder()
      .withName("Test Search Beta")
      .withDescription("Second item")
      .create();
    await new ExampleBuilder()
      .withName("Test Other")
      .withDescription("Not matching")
      .create();
  });

  afterEach(async () => {
    await ExampleTestHelper.cleanup("Test");
  });

  it("should find items by name", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await searchExamplesTool.handler(
      { query: "Search", skip: 0, take: 100 },
      context
    );

    const content = result.structuredContent as any;
    expect(content.items.length).toBeGreaterThanOrEqual(2);
    expect(content.items.some((i: any) => i.name.includes("Alpha"))).toBe(true);
    expect(content.items.some((i: any) => i.name.includes("Beta"))).toBe(true);
  });

  it("should find items by description", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await searchExamplesTool.handler(
      { query: "First item", skip: 0, take: 100 },
      context
    );

    const content = result.structuredContent as any;
    expect(content.items.length).toBeGreaterThanOrEqual(1);
  });

  it("should return empty for no matches", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await searchExamplesTool.handler(
      { query: "NonExistentQuery12345", skip: 0, take: 100 },
      context
    );

    const content = result.structuredContent as any;
    expect(content.items.length).toBe(0);
  });
});
