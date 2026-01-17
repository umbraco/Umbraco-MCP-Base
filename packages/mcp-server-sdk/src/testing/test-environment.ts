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
 * import { setupTestEnvironment } from "@umbraco-cms/mcp-server-sdk/testing";
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

/**
 * MSW server interface (subset of SetupServer from msw/node).
 * Using a minimal interface to avoid requiring msw as a dependency.
 */
interface MswServer {
  listen: (options?: { onUnhandledRequest?: "error" | "warn" | "bypass" }) => void;
  resetHandlers: () => void;
  close: () => void;
}

/**
 * Sets up MSW (Mock Service Worker) server for API mocking in tests.
 *
 * This helper:
 * - Starts the MSW server before all tests
 * - Resets handlers and optionally clears store after each test
 * - Closes the server after all tests
 *
 * Usage in jest-setup.ts (via setupFilesAfterEnv):
 * ```typescript
 * import { setupMswServer } from "@umbraco-cms/mcp-server-sdk/testing";
 * import { server } from "./mocks/server.js";
 * import { resetStore } from "./mocks/store.js";
 *
 * setupMswServer(server, resetStore);
 * ```
 *
 * @param server - The MSW server instance from setupServer()
 * @param resetStore - Optional function to reset mock data store between tests
 * @param options - Optional configuration
 */
export function setupMswServer(
  server: MswServer,
  resetStore?: () => void,
  options?: { onUnhandledRequest?: "error" | "warn" | "bypass" }
): void {
  const onUnhandledRequest = options?.onUnhandledRequest ?? "error";

  beforeAll(() => {
    server.listen({ onUnhandledRequest });
  });

  afterEach(() => {
    server.resetHandlers();
    resetStore?.();
  });

  afterAll(() => {
    server.close();
  });
}
