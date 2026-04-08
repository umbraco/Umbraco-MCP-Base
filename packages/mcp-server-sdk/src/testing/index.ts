/**
 * MCP Toolkit Testing
 *
 * Testing utilities for MCP tool development.
 */

export { BLANK_UUID } from "./constants.js";

export {
  createSnapshotResult,
  normalizeErrorResponse,
  normalizeObject,
} from "./snapshot-result.js";

export { setupTestEnvironment, setupMswServer } from "./test-environment.js";

export {
  createMockRequestHandlerExtra,
  getResultText,
  getStructuredContent,
  validateStructuredContent,
  validateErrorResult,
  validateToolResponse,
  problemDetailsSchema,
} from "./mock-handler.js";

export {
  setupElicitationMock,
  type ElicitationMock,
} from "./elicitation-mock.js";

/**
 * Typed result from a cursor-paginated tool response.
 * Cast validateToolResponse results to this when testing cursor-wrapped tools:
 *
 * ```typescript
 * const data = validateToolResponse(cursorTool, result) as CursorPaginatedResult;
 * expect(data.nextCursor).toBeDefined();
 * ```
 */
export interface CursorPaginatedResult {
  total: number;
  items: unknown[];
  nextCursor?: string;
}
