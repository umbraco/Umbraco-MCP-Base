import { describe, it, expect } from "@jest/globals";
import {
  FLOW_COOKIE_MAX_AGE,
  FlowBindingError,
  clearFlowCookieHeader,
  flowCookieName,
  hasMatchingFlowCookie,
  isCrossSiteSubmission,
  redirectResponse,
  setFlowCookieHeader,
  withSetCookies,
} from "../flow-cookies.js";

const STATE = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

function requestWithCookie(cookie?: string): Request {
  return new Request("https://worker.example.com/authorize", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("flowCookieName", () => {
  it("uses the __Host- prefix, the kind, and a 16-character prefix of the value", () => {
    expect(flowCookieName("consent", STATE)).toBe("__Host-mcp_consent_a1b2c3d4e5f60718");
    expect(flowCookieName("state", STATE)).toBe("__Host-mcp_state_a1b2c3d4e5f60718");
  });

  it("gives concurrent flows distinct cookie names", () => {
    const other = "ffff" + STATE.slice(4);
    expect(flowCookieName("consent", STATE)).not.toBe(flowCookieName("consent", other));
  });

  it("returns null for values that can't form a safe cookie name", () => {
    expect(flowCookieName("state", "")).toBeNull();
    expect(flowCookieName("state", "bad;value")).toBeNull();
    expect(flowCookieName("state", "a=b")).toBeNull();
    expect(flowCookieName("state", "spaces here")).toBeNull();
  });
});

describe("setFlowCookieHeader", () => {
  it("sets a Secure, HttpOnly, SameSite=Lax, host-only cookie with a 10-minute lifetime", () => {
    const header = setFlowCookieHeader("consent", STATE);
    expect(header).toBe(
      `__Host-mcp_consent_a1b2c3d4e5f60718=${STATE}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${FLOW_COOKIE_MAX_AGE}`
    );
    expect(FLOW_COOKIE_MAX_AGE).toBe(600);
    // __Host- cookies must not carry a Domain attribute
    expect(header).not.toMatch(/Domain=/i);
  });

  it("throws for a value that can't form a cookie name", () => {
    expect(() => setFlowCookieHeader("state", "bad;value")).toThrow();
  });
});

describe("clearFlowCookieHeader", () => {
  it("expires the cookie with the same name and attributes", () => {
    expect(clearFlowCookieHeader("state", STATE)).toBe(
      "__Host-mcp_state_a1b2c3d4e5f60718=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0"
    );
  });

  it("returns null when no cookie could exist for the value", () => {
    expect(clearFlowCookieHeader("state", "bad;value")).toBeNull();
  });
});

describe("hasMatchingFlowCookie", () => {
  it("accepts a request carrying the matching cookie", () => {
    const request = requestWithCookie(`other=1; __Host-mcp_state_a1b2c3d4e5f60718=${STATE}; x=y`);
    expect(hasMatchingFlowCookie(request, "state", STATE)).toBe(true);
  });

  it("rejects a request with no cookies", () => {
    expect(hasMatchingFlowCookie(requestWithCookie(), "state", STATE)).toBe(false);
  });

  it("rejects a cookie whose value differs from the submitted value", () => {
    const tampered = STATE.slice(0, -1) + "1";
    const request = requestWithCookie(`__Host-mcp_state_a1b2c3d4e5f60718=${STATE}`);
    expect(hasMatchingFlowCookie(request, "state", tampered)).toBe(false);
  });

  it("rejects a cookie of the other kind", () => {
    const request = requestWithCookie(`__Host-mcp_consent_a1b2c3d4e5f60718=${STATE}`);
    expect(hasMatchingFlowCookie(request, "state", STATE)).toBe(false);
  });

  it("rejects a value that can't form a cookie name", () => {
    const request = requestWithCookie("__Host-mcp_state_bad=bad;value");
    expect(hasMatchingFlowCookie(request, "state", "bad;value")).toBe(false);
  });

  it("picks the right cookie when two flows are in progress", () => {
    const other = "ffff" + STATE.slice(4);
    const request = requestWithCookie(
      `${flowCookieName("state", STATE)}=${STATE}; ${flowCookieName("state", other)}=${other}`
    );
    expect(hasMatchingFlowCookie(request, "state", STATE)).toBe(true);
    expect(hasMatchingFlowCookie(request, "state", other)).toBe(true);
  });
});

describe("isCrossSiteSubmission", () => {
  const origin = "https://worker.example.com";
  const post = (headers: Record<string, string>) =>
    new Request(`${origin}/authorize`, { method: "POST", headers });

  it("allows same-origin submissions", () => {
    expect(isCrossSiteSubmission(post({ "Sec-Fetch-Site": "same-origin" }), origin)).toBe(false);
  });

  it.each(["cross-site", "same-site", "none"])("rejects Sec-Fetch-Site: %s", (value) => {
    expect(isCrossSiteSubmission(post({ "Sec-Fetch-Site": value }), origin)).toBe(true);
  });

  it("falls back to Origin when Sec-Fetch-Site is absent", () => {
    expect(isCrossSiteSubmission(post({ Origin: origin }), origin)).toBe(false);
    expect(isCrossSiteSubmission(post({ Origin: "https://evil.example" }), origin)).toBe(true);
    expect(isCrossSiteSubmission(post({ Origin: "null" }), origin)).toBe(true);
  });

  it("prefers Sec-Fetch-Site over Origin", () => {
    expect(
      isCrossSiteSubmission(post({ "Sec-Fetch-Site": "cross-site", Origin: origin }), origin)
    ).toBe(true);
  });

  it("allows requests with neither header (the cookie check still applies)", () => {
    expect(isCrossSiteSubmission(post({}), origin)).toBe(false);
  });
});

describe("withSetCookies / redirectResponse", () => {
  it("appends every Set-Cookie header and skips nulls", () => {
    const response = withSetCookies(new Response("ok", { status: 201 }), ["a=1", null, "b=2"]);
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("works on responses with immutable headers", () => {
    const response = withSetCookies(Response.redirect("https://example.com/x", 302), ["a=1"]);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/x");
    expect(response.headers.getSetCookie()).toEqual(["a=1"]);
  });

  it("builds a 302 redirect carrying cookies", () => {
    const response = redirectResponse("https://example.com/next", ["a=1", null]);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/next");
    expect(response.headers.getSetCookie()).toEqual(["a=1"]);
  });
});

describe("FlowBindingError", () => {
  it("carries a 403 status", () => {
    const error = new FlowBindingError();
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(403);
    expect(error.name).toBe("FlowBindingError");
  });
});
