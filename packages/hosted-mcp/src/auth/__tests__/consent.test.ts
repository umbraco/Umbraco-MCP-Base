import { renderConsentScreen, consentResponse } from "../consent.js";
import type { ConsentScreenOptions } from "../consent.js";

function createOptions(
  overrides: Partial<ConsentScreenOptions> = {}
): ConsentScreenOptions {
  return {
    clientName: "Test MCP Client",
    umbracoBaseUrl: "https://my-umbraco.example.com",
    scopes: ["openid", "profile", "email"],
    redirectUri: "https://client.example.com/callback",
    actionUrl: "https://worker.example.com/authorize",
    state: "test-state-token-123",
    ...overrides,
  };
}

describe("renderConsentScreen", () => {
  it("returns valid HTML", () => {
    const html = renderConsentScreen(createOptions());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("displays the client name", () => {
    const html = renderConsentScreen(createOptions({ clientName: "My AI Tool" }));
    expect(html).toContain("My AI Tool");
  });

  it("displays the Umbraco base URL", () => {
    const html = renderConsentScreen(
      createOptions({ umbracoBaseUrl: "https://cms.example.com" })
    );
    expect(html).toContain("https://cms.example.com");
  });

  it("displays each requested scope", () => {
    const html = renderConsentScreen(
      createOptions({ scopes: ["openid", "custom-scope"] })
    );
    expect(html).toContain("openid");
    expect(html).toContain("custom-scope");
  });

  it('shows "Default access" when no scopes provided', () => {
    const html = renderConsentScreen(createOptions({ scopes: [] }));
    expect(html).toContain("Default access");
  });

  it("displays the redirect URI", () => {
    const html = renderConsentScreen(
      createOptions({ redirectUri: "https://app.test/cb" })
    );
    expect(html).toContain("https://app.test/cb");
  });

  it("includes the action URL in the form", () => {
    const html = renderConsentScreen(
      createOptions({ actionUrl: "https://worker.test/authorize?foo=bar" })
    );
    expect(html).toContain(
      'action="https://worker.test/authorize?foo=bar"'
    );
  });

  it("includes the state in a hidden field", () => {
    const html = renderConsentScreen(
      createOptions({ state: "my-csrf-state" })
    );
    expect(html).toContain('value="my-csrf-state"');
    expect(html).toContain('name="state"');
  });

  it("includes approve and deny buttons", () => {
    const html = renderConsentScreen(createOptions());
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="deny"');
  });

  it("escapes HTML special characters in client name", () => {
    const html = renderConsentScreen(
      createOptions({ clientName: '<script>alert("xss")</script>' })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML in URLs", () => {
    const html = renderConsentScreen(
      createOptions({ umbracoBaseUrl: 'https://example.com/"onload="alert(1)' })
    );
    expect(html).not.toContain('"onload=');
    expect(html).toContain("&quot;onload=");
  });

  it("escapes HTML in scopes", () => {
    const html = renderConsentScreen(
      createOptions({ scopes: ['<img src=x onerror="alert(1)">'] })
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("consentResponse", () => {
  it("returns a Response with HTML content type", () => {
    const response = consentResponse(createOptions());
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8"
    );
  });

  it("sets X-Frame-Options: DENY", () => {
    const response = consentResponse(createOptions());
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets Content-Security-Policy frame-ancestors none", () => {
    const response = consentResponse(createOptions());
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'none'"
    );
  });

  it("sets X-Content-Type-Options: nosniff", () => {
    const response = consentResponse(createOptions());
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
