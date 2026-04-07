/**
 * Elicitation Test Helpers
 *
 * Shared utilities for testing tools that use confirmAction() / elicitInput().
 * Reduces boilerplate across integration test files.
 *
 * @example
 * ```typescript
 * import { setupElicitationMock } from "@umbraco-cms/mcp-server-sdk/testing";
 *
 * const elicitation = setupElicitationMock();
 *
 * // In tests:
 * elicitation.acceptAll();   // confirmAction() returns true
 * elicitation.rejectAll();   // confirmAction() returns false
 * elicitation.reset();       // restore to acceptAll (use in beforeEach)
 *
 * // Verify elicitation was called:
 * expect(elicitation.mock).toHaveBeenCalled();
 * ```
 */

import { setServerRef, clearServerRef } from "../helpers/server-ref.js";

/**
 * Return type from setupElicitationMock().
 */
export interface ElicitationMock {
  /** The underlying jest.fn() mock for elicitInput. Use for assertions. */
  mock: ReturnType<typeof createMockFn>;
  /** Configure mock to accept all confirmations (default). */
  acceptAll: () => void;
  /** Configure mock to reject all confirmations. */
  rejectAll: () => void;
  /** Reset to default (acceptAll). Use in beforeEach. */
  reset: () => void;
  /** Clean up the server ref. Use in afterAll. */
  cleanup: () => void;
}

// Use a dynamic import-compatible mock function creator
// Tests must pass their jest.fn reference since we can't import jest in ESM
type MockFn = (...args: any[]) => any;
type JestMockFn = MockFn & {
  mockResolvedValue: (value: any) => any;
  mockReset: () => any;
};

function createMockFn(): JestMockFn {
  // This will be overridden by the caller
  throw new Error("createMockFn should not be called directly");
}

/**
 * Set up elicitation mocking for integration tests.
 *
 * Creates a mock server with a jest.fn() for elicitInput, registers it
 * via setServerRef(), and returns helpers to control acceptance/rejection.
 *
 * Defaults to accepting all confirmations (confirmAction returns true).
 *
 * @param jestFn - Pass jest.fn to create the mock (required for ESM compatibility)
 * @returns ElicitationMock with mock, acceptAll, rejectAll, reset, cleanup
 *
 * @example
 * ```typescript
 * import { jest } from "@jest/globals";
 * import { setupElicitationMock } from "@umbraco-cms/mcp-server-sdk/testing";
 *
 * const elicitation = setupElicitationMock(jest.fn);
 *
 * beforeEach(() => elicitation.reset());
 * afterAll(() => elicitation.cleanup());
 * ```
 */
export function setupElicitationMock(
  jestFn: () => JestMockFn,
): ElicitationMock {
  const mock = jestFn() as JestMockFn;

  const acceptAll = () => {
    mock.mockResolvedValue({ action: "accept", content: { confirm: true } });
  };

  const rejectAll = () => {
    mock.mockResolvedValue({ action: "decline", content: {} });
  };

  const reset = () => {
    mock.mockReset();
    acceptAll();
  };

  // Initialize to accept by default
  acceptAll();

  // Register the mock server
  setServerRef({ elicitInput: mock } as any);

  return {
    mock,
    acceptAll,
    rejectAll,
    reset,
    cleanup: clearServerRef,
  };
}
