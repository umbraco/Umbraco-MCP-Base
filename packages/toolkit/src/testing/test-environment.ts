/**
 * Test Environment Setup
 *
 * Utilities for setting up Jest test environments.
 */

import { jest } from "@jest/globals";

/**
 * Sets up the standard test environment for all tests.
 *
 * This helper:
 * - Mocks console.error in beforeEach to suppress expected error output
 * - Restores console.error in afterEach to prevent test pollution
 *
 * Usage:
 * ```typescript
 * import { setupTestEnvironment } from "@umbraco-cms/mcp-toolkit/testing";
 *
 * describe("my-test", () => {
 *   setupTestEnvironment();
 *
 *   // Your tests here...
 * });
 * ```
 */
export function setupTestEnvironment(): void {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });
}
