/**
 * List Examples Tool Tests (GET list)
 */

import {
  setupTestEnvironment,
  createMockRequestHandlerExtra,
  ExampleBuilder,
  ExampleTestHelper,
} from "./setup.js";
import { encodeCursor } from "@umbraco-cms/mcp-server-sdk";
import listExamplesTool from "../get/list-examples.js";

describe("list-examples", () => {
  setupTestEnvironment();

  beforeEach(async () => {
    await new ExampleBuilder().withName("Test List 1").create();
    await new ExampleBuilder().withName("Test List 2").create();
    await new ExampleBuilder().withName("Test List 3").create();
  });

  afterEach(async () => {
    await ExampleTestHelper.cleanup("Test");
  });

  it("should return paginated list", async () => {
    const context = createMockRequestHandlerExtra();

    const result = await listExamplesTool.handler({}, context);

    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.total).toBeGreaterThanOrEqual(3);
    expect(content.items).toBeDefined();
    expect(Array.isArray(content.items)).toBe(true);
  });

  it("should support cursor-based pagination", async () => {
    const context = createMockRequestHandlerExtra();

    // Request 2 items via cursor encoding
    const cursor = encodeCursor({ s: 0, t: 2 });
    const result = await listExamplesTool.handler(
      { cursor },
      context
    );

    const content = result.structuredContent as any;
    expect(content.items.length).toBe(2);
    expect(content.nextCursor).toBeDefined();
  });
});
