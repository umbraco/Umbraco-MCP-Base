import { jest } from "@jest/globals";
import {
  checkUmbracoVersion,
  getVersionCheckMessage,
  clearVersionCheckMessage,
  isToolExecutionBlocked,
  versionCheckService,
  VersionCheckService,
  type VersionCheckClient
} from "../check-umbraco-version.js";

describe("VersionCheckService", () => {
  let service: VersionCheckService;

  beforeEach(() => {
    service = new VersionCheckService();
  });

  it("should start with null message and not blocked", () => {
    expect(service.getMessage()).toBeNull();
    expect(service.isBlocked()).toBe(false);
  });

  it("should set and get message", () => {
    service.setMessage("test message");
    expect(service.getMessage()).toBe("test message");
  });

  it("should set and get blocked state", () => {
    service.setBlocked(true);
    expect(service.isBlocked()).toBe(true);
    service.setBlocked(false);
    expect(service.isBlocked()).toBe(false);
  });

  it("should clear message and blocked state", () => {
    service.setMessage("test message");
    service.setBlocked(true);
    service.clear();
    expect(service.getMessage()).toBeNull();
    expect(service.isBlocked()).toBe(false);
  });

  it("should reset state", () => {
    service.setMessage("test message");
    service.setBlocked(true);
    service.reset();
    expect(service.getMessage()).toBeNull();
    expect(service.isBlocked()).toBe(false);
  });
});

describe("checkUmbracoVersion", () => {
  beforeEach(() => {
    // Reset the singleton service state between tests
    versionCheckService.reset();
  });

  // `expectedUmbracoMajor` is a *required* field, so "caller forgot it" is a
  // compile error, not a runtime case worth testing. What can still reach the
  // runtime is a blank value from a misconfigured override (e.g.
  // `UMBRACO_EXPECTED_MAJOR=""`). That must degrade gracefully — skip the
  // comparison, clear state, make no network call — rather than crash or
  // falsely flag a mismatch (umbraco/Umbraco-MCP-Base#220).
  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("should degrade to a no-op when expectedUmbracoMajor is %s", async (_label, expected) => {
    // Arrange
    const getServerInformation = jest.fn<() => Promise<{ version: string }>>()
      .mockResolvedValue({ version: "17.0.0" });
    const mockClient: VersionCheckClient = { getServerInformation };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: expected,
      client: mockClient
    });

    // Assert - no message, not blocked, and no network call was made
    expect(getVersionCheckMessage()).toBeNull();
    expect(isToolExecutionBlocked()).toBe(false);
    expect(getServerInformation).not.toHaveBeenCalled();
  });

  it.each([
    ["a full version string", "17.0.0"],
    ["surrounding whitespace", " 17 "],
  ])("should tolerate %s in expectedUmbracoMajor", async (_label, expected) => {
    // Arrange
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "17.2.0" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: expected,
      client: mockClient
    });

    // Assert - normalised to "17", so this is a match
    expect(getVersionCheckMessage()).toBeNull();
    expect(isToolExecutionBlocked()).toBe(false);
  });

  it("should not compare against mcpVersion's major", async () => {
    // Arrange - mcpVersion major ("1") differs from Umbraco's ("17") but the
    // declared target major matches, so this must NOT be reported as a mismatch.
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "17.2.0" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0-beta.33",
      expectedUmbracoMajor: "17",
      client: mockClient
    });

    // Assert
    expect(getVersionCheckMessage()).toBeNull();
    expect(isToolExecutionBlocked()).toBe(false);
  });

  it("should not store message when major versions match", async () => {
    // Arrange
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "17.3.1" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "17",
      client: mockClient
    });

    // Assert - no message needed when versions match
    const message = getVersionCheckMessage();
    expect(message).toBeNull();
    expect(isToolExecutionBlocked()).toBe(false);
  });

  it("should store warning and block when major versions mismatch", async () => {
    // Arrange
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "15.3.1" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "17",
      client: mockClient
    });

    // Assert
    const message = getVersionCheckMessage();
    expect(message).toContain("⚠️ Version Mismatch");
    expect(message).toContain("Connected to Umbraco 15.x");
    expect(message).toContain("this server targets Umbraco 17.x");
    expect(message).toContain("compatibility issues");
    expect(isToolExecutionBlocked()).toBe(true);
  });

  it("should not block when the declared target major is non-numeric", async () => {
    // Arrange - the mirror of the case below, and the reason both sides must use
    // the same parser. With `split('.')[0]` the declared target "Latest" was
    // truthy, cleared the guard, compared unequal to every real major, and so
    // blocked every tool call against a perfectly healthy instance — reporting
    // "this server targets Umbraco Latest.x" and blaming the instance rather
    // than the misconfigured override. Plausible input: someone reads that
    // Umbraco's spec says "Latest" and pastes it into UMBRACO_EXPECTED_MAJOR,
    // or a script does UMBRACO_EXPECTED_MAJOR=$(jq -r .info.version spec.json).
    const getServerInformation = jest.fn<() => Promise<{ version: string }>>()
      .mockResolvedValue({ version: "18.0.2" });

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "Latest",
      client: { getServerInformation }
    });

    // Assert - reported, not enforced.
    expect(isToolExecutionBlocked()).toBe(false);
    expect(getVersionCheckMessage()).toContain("is not a version");
    expect(getVersionCheckMessage()).not.toContain("Version Mismatch");
  });

  it("should stay silent when no target major is declared at all", async () => {
    // Arrange - absent is the documented degrade-quietly case, distinct from
    // present-but-unusable above: nothing was set, so there is nothing to report.
    const getServerInformation = jest.fn<() => Promise<{ version: string }>>()
      .mockResolvedValue({ version: "18.0.2" });

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "",
      client: { getServerInformation }
    });

    // Assert
    expect(isToolExecutionBlocked()).toBe(false);
    expect(getVersionCheckMessage()).toBeNull();
    expect(getServerInformation).not.toHaveBeenCalled();
  });

  it("should handle a non-numeric reported version gracefully without blocking", async () => {
    // Arrange - every real Umbraco reports a numeric-leading semver, but a
    // reported version that doesn't parse to a major (e.g. some non-Umbraco
    // endpoint, or a future format) must not produce a "null.x" message nor a
    // false mismatch block.
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "Latest" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "17",
      client: mockClient
    });

    // Assert
    const message = getVersionCheckMessage();
    expect(message).toContain("⚠️ Unable to verify");
    expect(message).toContain("Latest");
    expect(isToolExecutionBlocked()).toBe(false);
  });

  it("should handle API errors gracefully without blocking", async () => {
    // Arrange
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockRejectedValue(new Error("Network error"))
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "17",
      client: mockClient
    });

    // Assert
    const message = getVersionCheckMessage();
    expect(message).toContain("⚠️ Unable to verify");
    expect(message).toContain("Network error");
    expect(isToolExecutionBlocked()).toBe(false);
  });

  it("should handle prerelease versions correctly", async () => {
    // Arrange
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "17.0.0-rc1" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0-beta.2",
      expectedUmbracoMajor: "17",
      client: mockClient
    });

    // Assert - should match on major version "17", no message needed
    const message = getVersionCheckMessage();
    expect(message).toBeNull();
    expect(isToolExecutionBlocked()).toBe(false);
  });

  it("should clear message when clearVersionCheckMessage is called", async () => {
    // Arrange - use mismatch to generate a message
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "15.3.1" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "17",
      client: mockClient
    });
    expect(getVersionCheckMessage()).not.toBeNull();

    clearVersionCheckMessage();

    // Assert
    expect(getVersionCheckMessage()).toBeNull();
  });

  it("should unblock when clearVersionCheckMessage is called on mismatch", async () => {
    // Arrange - use mismatch to trigger blocking
    const mockClient: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<{ version: string }>>()
        .mockResolvedValue({ version: "15.3.1" })
    };

    // Act
    await checkUmbracoVersion({
      mcpVersion: "1.0.0",
      expectedUmbracoMajor: "17",
      client: mockClient
    });
    expect(isToolExecutionBlocked()).toBe(true);

    clearVersionCheckMessage(); // Should clear both message and blocking

    // Assert
    expect(isToolExecutionBlocked()).toBe(false);
    expect(getVersionCheckMessage()).toBeNull();
  });
});
