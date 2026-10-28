import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  assessNodeVersion,
  checkNodeVersion,
  formatNodeVersionWarning,
  resetNodeVersionCheck,
} from "../check-node-version.js";

describe("assessNodeVersion", () => {
  it.each([
    ["22.0.0", "vulnerable"],
    ["22.23.3", "vulnerable"],
    ["22.23.4", "ok"],
    ["22.24.0", "ok"],
    ["24.22.0", "vulnerable"],
    ["24.22.1", "ok"],
    ["26.12.0", "vulnerable"],
    ["26.12.1", "ok"],
    ["27.0.0", "ok"],
    ["20.19.0", "unsupported"],
    ["23.11.0", "unsupported"],
    ["25.0.0", "unsupported"],
    ["v22.23.4", "ok"],
    ["22.23.4-pre", "ok"],
    ["Latest", "unknown"],
  ])("classifies %s as %s", (version, status) => {
    expect(assessNodeVersion(version).status).toBe(status);
  });

  it("reports the first patched release of the same line", () => {
    expect(assessNodeVersion("24.1.0")).toEqual({ status: "vulnerable", version: "24.1.0", minimumFixed: "24.22.1" });
  });
});

describe("formatNodeVersionWarning", () => {
  it("names the CVE and the patched versions", () => {
    const message = formatNodeVersionWarning(assessNodeVersion("22.17.0"));
    expect(message).toContain("[umbraco-mcp]");
    expect(message).toContain("Node.js v22.17.0");
    expect(message).toContain("CVE-2026-111497");
    expect(message).toContain("22.23.4, 24.22.1 or 26.12.1");
  });

  it("returns null for patched and unknown versions", () => {
    expect(formatNodeVersionWarning(assessNodeVersion("22.23.4"))).toBeNull();
    expect(formatNodeVersionWarning(assessNodeVersion("Latest"))).toBeNull();
  });
});

describe("checkNodeVersion", () => {
  beforeEach(() => resetNodeVersionCheck());

  it("logs once per process", () => {
    const log = jest.fn();
    const message = checkNodeVersion({ version: "22.17.0", log });
    checkNodeVersion({ version: "22.17.0", log });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(message);
  });

  it.each(["22.23.4", "Latest"])("logs nothing for %s", (version) => {
    const log = jest.fn();
    expect(checkNodeVersion({ version, log })).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("writes to stderr by default", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    checkNodeVersion({ version: "23.11.0" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
