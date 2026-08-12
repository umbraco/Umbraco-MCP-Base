import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { buildFirewallHeader, DEFAULT_UMBRACO_MCP_HEADER_NAME } from "../firewall-header.js";

// Issue #234: operators behind an IP allow-list firewall need a fixed,
// identifiable header on every server-side request so a firewall rule can
// let it through. Every call site (Management API, OAuth token
// request/refresh, Cloud reachability probe) funnels through this one
// function, so its branches are covered directly here rather than duplicated
// per call site.
describe("buildFirewallHeader", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns {} when UMBRACO_MCP_HEADER_VALUE is unset", () => {
    expect(buildFirewallHeader({})).toEqual({});
  });

  it("returns {} when UMBRACO_MCP_HEADER_VALUE is an empty string", () => {
    expect(buildFirewallHeader({ UMBRACO_MCP_HEADER_VALUE: "" })).toEqual({});
  });

  it("returns {} when only UMBRACO_MCP_HEADER_NAME is set (no value)", () => {
    expect(buildFirewallHeader({ UMBRACO_MCP_HEADER_NAME: "X-Custom" })).toEqual({});
  });

  it("defaults to X-Umbraco-Mcp when no name is given", () => {
    expect(buildFirewallHeader({ UMBRACO_MCP_HEADER_VALUE: "secret-value" })).toEqual({
      [DEFAULT_UMBRACO_MCP_HEADER_NAME]: "secret-value",
    });
  });

  it("uses a custom header name when provided", () => {
    expect(
      buildFirewallHeader({
        UMBRACO_MCP_HEADER_NAME: "X-Custom-Header",
        UMBRACO_MCP_HEADER_VALUE: "secret-value",
      })
    ).toEqual({ "X-Custom-Header": "secret-value" });
  });

  // A misconfigured value (e.g. a trailing newline from a copy/paste) would
  // otherwise make the underlying `fetch` throw a generic TypeError deep
  // inside every call site — or, in `defaultValidateProject`'s broad
  // try/catch, be silently swallowed as "site not found" with no trace of
  // the real cause. Rejecting it here fails loudly with a clear cause instead.
  it("omits the header and logs when the value contains a control character", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(buildFirewallHeader({ UMBRACO_MCP_HEADER_VALUE: "bad\nvalue" })).toEqual({});
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("control character"));
  });

  it("omits the header when the name contains a control character", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    expect(
      buildFirewallHeader({
        UMBRACO_MCP_HEADER_NAME: "X-Bad\r\nHeader",
        UMBRACO_MCP_HEADER_VALUE: "secret-value",
      })
    ).toEqual({});
  });
});
