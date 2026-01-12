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

export { setupTestEnvironment } from "./test-environment.js";

export {
  createMockRequestHandlerExtra,
  getResultText,
  getStructuredContent,
  validateStructuredContent,
  validateErrorResult,
  validateToolResponse,
  problemDetailsSchema,
} from "./mock-handler.js";
