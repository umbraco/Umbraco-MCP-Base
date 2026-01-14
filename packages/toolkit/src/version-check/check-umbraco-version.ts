/**
 * Version Check Utilities
 *
 * Generic version checking functionality for MCP servers.
 * Projects should pass their own version and client.
 */

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
  /** The MCP server version (e.g., "16.0.0-beta.2") */
  mcpVersion: string;
  /** Client to fetch server information */
  client: VersionCheckClient;
  /** Optional custom service instance (defaults to singleton) */
  service?: VersionCheckService;
}

/**
 * Checks if the connected server version matches the MCP server major version.
 * Stores the result message internally for display in the first tool response.
 * Blocks tool execution on version mismatch until user acknowledges.
 * Non-blocking - never throws errors, always continues execution.
 *
 * @param options - Version check options
 */
export async function checkUmbracoVersion(options: CheckVersionOptions): Promise<void> {
  const { mcpVersion, client, service = versionCheckService } = options;

  try {
    const serverInfo = await client.getServerInformation();
    const umbracoVersion = serverInfo.version; // e.g., "15.3.1" or "16.0.0"

    // Extract major version from both MCP version and Umbraco version
    const mcpMajor = mcpVersion.split('.')[0]; // "16.0.0-beta.2" → "16"
    const umbracoMajor = umbracoVersion.split('.')[0]; // "16.3.1" → "16"

    if (umbracoMajor === mcpMajor) {
      // Versions match - no message needed
      service.setMessage(null);
      service.setBlocked(false);
    } else {
      service.setMessage(
        `⚠️ Version Mismatch: Connected to Umbraco ${umbracoMajor}.x, but MCP server (${mcpVersion}) expects Umbraco ${mcpMajor}.x\n   This may cause compatibility issues with the Management API.`
      );
      service.setBlocked(true); // Block tool execution until user acknowledges
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    service.setMessage(
      `⚠️ Unable to verify Umbraco version compatibility: ${errorMessage}`
    );
    service.setBlocked(false); // Don't block on API errors
  }
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
