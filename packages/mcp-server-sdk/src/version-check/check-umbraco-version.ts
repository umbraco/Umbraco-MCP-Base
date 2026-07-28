/**
 * Version Check Utilities
 *
 * Generic version checking functionality for MCP servers.
 * Projects should pass their own version and client.
 */

import { configurePreExecutionHook } from "../helpers/tool-decorators.js";

/**
 * Interface for a client that can fetch server information.
 * Implement this in your project to provide version info.
 */
export interface VersionCheckClient {
  getServerInformation(): Promise<{ version: string }>;
}

/**
 * Service class that encapsulates version check state.
 * Uses a class to avoid module-level mutable state, making it:
 * - Easier to test (state can be reset)
 * - Thread-safe in multi-instance scenarios
 * - More maintainable and explicit about state management
 */
export class VersionCheckService {
  private message: string | null = null;
  private blocked: boolean = false;

  /**
   * Sets the version check message.
   */
  setMessage(msg: string | null): void {
    this.message = msg;
  }

  /**
   * Gets the stored version check message.
   */
  getMessage(): string | null {
    return this.message;
  }

  /**
   * Sets the blocked state.
   */
  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
  }

  /**
   * Checks if tool execution is currently blocked.
   */
  isBlocked(): boolean {
    return this.blocked;
  }

  /**
   * Clears the message and unblocks tool execution.
   */
  clear(): void {
    this.message = null;
    this.blocked = false;
  }

  /**
   * Resets the service state (useful for testing).
   */
  reset(): void {
    this.clear();
  }
}

// Singleton instance for application-wide use
export const versionCheckService = new VersionCheckService();

/**
 * Options for version check.
 */
export interface CheckVersionOptions {
  /**
   * The MCP server's own package version (e.g., "1.0.0-beta.33").
   *
   * Kept for logging/diagnostics only — it is deliberately *not* used in the
   * compatibility comparison. An MCP server's own semver has no relationship
   * to the Umbraco major it targets (freshly scaffolded projects start at
   * "1.0.0"), so comparing it against the connected instance produced false
   * mismatches. See `expectedUmbracoMajor`.
   */
  mcpVersion: string;
  /**
   * The Umbraco major version this server explicitly targets (e.g., "17").
   *
   * If omitted (or blank), no version-compatibility check is performed at all:
   * no request is made, no message is stored, and nothing is blocked. Opting in
   * is deliberate so servers that don't declare a target major (including
   * every freshly scaffolded project) never get a spurious mismatch warning.
   *
   * Surrounding whitespace and a full version string ("17.0.0") are tolerated —
   * only the leading major component is compared.
   */
  expectedUmbracoMajor?: string;
  /** Client to fetch server information */
  client: VersionCheckClient;
  /** Optional custom service instance (defaults to singleton) */
  service?: VersionCheckService;
}

/**
 * Checks whether the connected Umbraco major version matches the major version
 * this MCP server explicitly declares it targets (`expectedUmbracoMajor`).
 *
 * **Opt-in.** When `expectedUmbracoMajor` is omitted the check is skipped
 * entirely — no server-information request is made, the message is cleared and
 * nothing is blocked. This is the safe default: a server's own package version
 * says nothing about which Umbraco major it targets (scaffolded projects start
 * at "1.0.0"), so an implicit comparison would falsely block the first tool
 * call of every new project.
 *
 * When it *is* provided, the result message is stored internally for display in
 * the first tool response (see `getVersionCheckMessage` / server
 * `instructions`), and also logged immediately via `console.error` (stderr) so
 * it's visible even if a host never reads the message back out. `console.error`
 * is stdio-transport safe — it never writes to stdout, so it can't corrupt the
 * MCP protocol stream.
 *
 * Blocks tool execution on version mismatch until the user acknowledges — call
 * `configureVersionCheckHook()` to wire that blocking into
 * `withStandardDecorators`/`withPreExecutionCheck`; without it, `isBlocked()`
 * is set but nothing consults it.
 *
 * Non-blocking - never throws errors, always continues execution.
 *
 * @param options - Version check options
 */
export async function checkUmbracoVersion(options: CheckVersionOptions): Promise<void> {
  const { expectedUmbracoMajor, client, service = versionCheckService } = options;

  // Normalise the declared target: it arrives from an env var / CLI flag, so
  // tolerate surrounding whitespace and a full version string ("17.0.0") when
  // only the major ("17") is meaningful.
  const targetMajor = expectedUmbracoMajor?.trim().split('.')[0];

  // No explicit target major declared → nothing to compare against, so skip
  // the check entirely (including the network call) and leave tools unblocked.
  if (!targetMajor) {
    service.setMessage(null);
    service.setBlocked(false);
    return;
  }

  try {
    const serverInfo = await client.getServerInformation();
    const umbracoVersion = serverInfo.version; // e.g., "15.3.1" or "16.0.0"

    // Compare the connected instance's major against the explicitly declared
    // target major (never against the MCP server's own package version).
    const umbracoMajor = umbracoVersion.split('.')[0]; // "16.3.1" → "16"

    if (umbracoMajor === targetMajor) {
      // Versions match - no message needed
      service.setMessage(null);
      service.setBlocked(false);
    } else {
      const message = `⚠️ Version Mismatch: Connected to Umbraco ${umbracoMajor}.x, but this server targets Umbraco ${targetMajor}.x\n   This may cause compatibility issues with the Management API.`;
      service.setMessage(message);
      service.setBlocked(true); // Block tool execution until user acknowledges
      console.error(message);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const message = `⚠️ Unable to verify Umbraco version compatibility: ${errorMessage}`;
    service.setMessage(message);
    service.setBlocked(false); // Don't block on API errors
    console.error(message);
  }
}

/**
 * Bridges the version check singleton to the pre-execution hook consumed by
 * `withPreExecutionCheck` (applied to every tool via `withStandardDecorators`).
 *
 * Call this once at startup, immediately after `checkUmbracoVersion()`. Without
 * it, `versionCheckService.isBlocked()` may be `true` but nothing ever reads it
 * back out, so no tool is actually blocked — the check becomes dead code.
 *
 * The returned hook clears the service (via `clearAfterUse`) once it has
 * surfaced the blocking message once, so a deliberate retry after the user
 * has seen the warning succeeds.
 *
 * Harmless when the check was skipped (no `expectedUmbracoMajor` declared) —
 * the service is never blocked in that case, so the hook always falls through.
 *
 * @param service - Optional service instance (defaults to singleton)
 *
 * @example
 * ```typescript
 * await checkUmbracoVersion({
 *   mcpVersion: packageJson.version,
 *   expectedUmbracoMajor: "17", // omit to disable the check entirely
 *   client,
 * });
 * configureVersionCheckHook();
 * ```
 */
export function configureVersionCheckHook(service: VersionCheckService = versionCheckService): void {
  configurePreExecutionHook(() =>
    service.isBlocked()
      ? { blocked: true, message: service.getMessage() ?? undefined, clearAfterUse: () => service.clear() }
      : undefined
  );
}

/**
 * Gets the stored version check message, if any.
 * @param service - Optional service instance (defaults to singleton)
 * @returns The version check message or null if not set
 */
export function getVersionCheckMessage(service: VersionCheckService = versionCheckService): string | null {
  return service.getMessage();
}

/**
 * Clears the stored version check message and unblocks tool execution.
 * Called after the message has been displayed to the user.
 * @param service - Optional service instance (defaults to singleton)
 */
export function clearVersionCheckMessage(service: VersionCheckService = versionCheckService): void {
  service.clear();
}

/**
 * Checks if tool execution is currently blocked due to version mismatch.
 * @param service - Optional service instance (defaults to singleton)
 * @returns true if tools should be blocked, false otherwise
 */
export function isToolExecutionBlocked(service: VersionCheckService = versionCheckService): boolean {
  return service.isBlocked();
}
