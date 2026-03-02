import { renderConsentScreen, consentResponse } from "../consent.js";
import type { ConsentScreenOptions, ConsentToolConfig } from "../consent.js";

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

describe("renderConsentScreen with serverName", () => {
  it("shows server name in the title", () => {
    const html = renderConsentScreen(
      createOptions({ serverName: "My CMS Server" })
    );
    expect(html).toContain("Authorize My CMS Server");
  });

  it("escapes server name", () => {
    const html = renderConsentScreen(
      createOptions({ serverName: '<b>Evil</b>' })
    );
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("renderConsentScreen with customCss", () => {
  it("injects custom CSS", () => {
    const html = renderConsentScreen(
      createOptions({ customCss: "body { background: red; }" })
    );
    expect(html).toContain("body { background: red; }");
  });
});

describe("renderConsentScreen with renderConsent override", () => {
  it("calls renderConsent instead of default rendering", () => {
    const customRenderer = (opts: ConsentScreenOptions) =>
      `<html><body>Custom: ${opts.clientName}</body></html>`;
    const html = renderConsentScreen(
      createOptions({ renderConsent: customRenderer })
    );
    expect(html).toBe("<html><body>Custom: Test MCP Client</body></html>");
    expect(html).not.toContain("<!DOCTYPE html>");
  });
});

describe("renderConsentScreen with toolConfig", () => {
  const toolConfig: ConsentToolConfig = {
    modes: [
      {
        name: "content",
        displayName: "Content Management",
        description: "Manage content nodes",
        collections: [
          { name: "document", displayName: "Documents", description: "Document types" },
          { name: "media", displayName: "Media", description: "Media items" },
        ],
        defaultSelected: true,
      },
      {
        name: "settings",
        displayName: "Settings",
        description: "Manage site settings",
        collections: [
          { name: "data-type", displayName: "Data Types", description: "Data type config" },
        ],
        defaultSelected: false,
      },
    ],
    showReadOnlyToggle: true,
  };

  it("renders mode checkboxes", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain("Tool Modes");
    expect(html).toContain("Content Management");
    expect(html).toContain("Settings");
  });

  it("renders mode descriptions", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain("Manage content nodes");
    expect(html).toContain("Manage site settings");
  });

  it("renders collection checkboxes with selectedCollections[] name", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain('name="selectedCollections[]"');
  });

  it("renders collection checkbox values matching collection names", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain('value="document"');
    expect(html).toContain('value="media"');
    expect(html).toContain('value="data-type"');
  });

  it("renders collection display names within modes", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain("Documents");
    expect(html).toContain("Media");
    expect(html).toContain("Data Types");
  });

  it("checks collection checkboxes when mode is defaultSelected", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    // Collections under defaultSelected mode should be checked
    expect(html).toContain('value="document" checked');
    expect(html).toContain('value="media" checked');
  });

  it("disables collection checkboxes when mode is not defaultSelected", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    // data-type is under settings (not defaultSelected), should be disabled
    expect(html).toContain('value="data-type" disabled');
  });

  it("sets checked attribute for defaultSelected modes", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    // The content mode has defaultSelected: true
    expect(html).toContain('value="content" checked');
    // The settings mode has defaultSelected: false — no checked attribute
    expect(html).not.toMatch(/value="settings"[^>]*checked/);
  });

  it("renders selectedModes[] as the checkbox name", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain('name="selectedModes[]"');
  });

  it("renders read-only toggle", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain('name="readOnly"');
    expect(html).toContain("Read-only mode");
  });

  it("does not render read-only toggle when showReadOnlyToggle is false", () => {
    const config: ConsentToolConfig = {
      ...toolConfig,
      showReadOnlyToggle: false,
    };
    const html = renderConsentScreen(createOptions({ toolConfig: config }));
    expect(html).not.toContain('name="readOnly"');
  });

  it("includes inline script for mode-collection toggle", () => {
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain("<script>");
    expect(html).toContain("mode-checkbox");
    expect(html).toContain("collection-checkbox");
  });

  it("does not render tool selection when no toolConfig", () => {
    const html = renderConsentScreen(createOptions());
    expect(html).not.toContain("Tool Modes");
    expect(html).not.toContain('name="selectedModes[]"');
    expect(html).not.toContain('name="readOnly"');
  });

  it("escapes mode names in HTML", () => {
    const evilConfig: ConsentToolConfig = {
      modes: [
        {
          name: "evil",
          displayName: '<script>alert("xss")</script>',
          description: "test",
          collections: [],
          defaultSelected: false,
        },
      ],
    };
    const html = renderConsentScreen(createOptions({ toolConfig: evilConfig }));
    // The injected displayName should be escaped, not rendered as a real script tag
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderConsentScreen with slices", () => {
  const toolConfigWithSlices: ConsentToolConfig = {
    slices: [
      { name: "read", displayName: "Read", defaultSelected: true },
      { name: "create", displayName: "Create", defaultSelected: true },
      { name: "update", displayName: "Update", defaultSelected: true },
      { name: "delete", displayName: "Delete", defaultSelected: true },
      { name: "list", displayName: "List", defaultSelected: true },
    ],
    showReadOnlyToggle: true,
  };

  it("renders slice checkboxes with selectedSlices[] name", () => {
    const html = renderConsentScreen(createOptions({ toolConfig: toolConfigWithSlices }));
    expect(html).toContain('name="selectedSlices[]"');
  });

  it("renders all slice checkboxes as checked by default", () => {
    const html = renderConsentScreen(createOptions({ toolConfig: toolConfigWithSlices }));
    expect(html).toContain('value="read" checked');
    expect(html).toContain('value="create" checked');
    expect(html).toContain('value="update" checked');
    expect(html).toContain('value="delete" checked');
    expect(html).toContain('value="list" checked');
  });

  it("renders Operations heading", () => {
    const html = renderConsentScreen(createOptions({ toolConfig: toolConfigWithSlices }));
    expect(html).toContain("Operations");
  });

  it("renders slice display names", () => {
    const html = renderConsentScreen(createOptions({ toolConfig: toolConfigWithSlices }));
    expect(html).toContain("Read");
    expect(html).toContain("Create");
    expect(html).toContain("Delete");
  });

  it("does not render slice section when slices not in config", () => {
    const toolConfig: ConsentToolConfig = { showReadOnlyToggle: true };
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).not.toContain("Operations");
    expect(html).not.toContain('name="selectedSlices[]"');
  });

  it("does not render slice section when slices array is empty", () => {
    const toolConfig: ConsentToolConfig = { slices: [], showReadOnlyToggle: true };
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).not.toContain("Operations");
    expect(html).not.toContain('name="selectedSlices[]"');
  });

  it("renders unchecked slices when defaultSelected is false", () => {
    const toolConfig: ConsentToolConfig = {
      slices: [
        { name: "read", displayName: "Read", defaultSelected: true },
        { name: "delete", displayName: "Delete", defaultSelected: false },
      ],
    };
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).toContain('value="read" checked');
    expect(html).not.toMatch(/value="delete"[^>]*checked/);
  });

  it("escapes slice names in HTML", () => {
    const toolConfig: ConsentToolConfig = {
      slices: [
        { name: '<script>evil</script>', displayName: '<b>Bold</b>', defaultSelected: true },
      ],
    };
    const html = renderConsentScreen(createOptions({ toolConfig }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("renderConsentScreen with sites", () => {
  it("renders radio buttons for multiple sites", () => {
    const html = renderConsentScreen(
      createOptions({
        sites: [
          { id: "prod", displayName: "Production", baseUrl: "https://prod.example.com" },
          { id: "staging", displayName: "Staging", baseUrl: "https://staging.example.com" },
        ],
      })
    );
    expect(html).toContain("Production");
    expect(html).toContain("Staging");
    expect(html).toContain('name="siteId"');
    expect(html).toContain('value="prod"');
    expect(html).toContain('value="staging"');
    expect(html).toContain("Umbraco Instance");
    // First site should be checked by default
    expect(html).toContain('value="prod" checked');
  });

  it("renders hidden field for single site", () => {
    const html = renderConsentScreen(
      createOptions({
        sites: [
          { id: "prod", displayName: "Production", baseUrl: "https://prod.example.com" },
        ],
      })
    );
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="siteId"');
    expect(html).toContain('value="prod"');
    expect(html).toContain("Production");
  });

  it("renders default Umbraco Instance field when sites is empty", () => {
    const html = renderConsentScreen(createOptions({ sites: [] }));
    expect(html).toContain("Umbraco Instance");
    expect(html).toContain("https://my-umbraco.example.com");
    expect(html).not.toContain('class="site-selection"');
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
