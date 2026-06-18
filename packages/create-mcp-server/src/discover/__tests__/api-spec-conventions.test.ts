import { describe, it, expect } from "@jest/globals";
import {
  OPENAPI_SWITCH_MAJOR,
  SWAGGER_UI_BASE_PATH,
  docsUiCandidates,
  oauthRedirectCandidates,
  specUrlCandidates,
  uiConfigSources,
} from "../api-spec-conventions.js";

const BASE = "https://localhost:44391";

describe("api-spec-conventions", () => {
  it("codifies the Umbraco 18 switch point", () => {
    expect(OPENAPI_SWITCH_MAJOR).toBe(18);
    expect(SWAGGER_UI_BASE_PATH).toBe("/umbraco/swagger");
  });

  it("probes the openapi (18+) convention before swagger (≤17)", () => {
    const specs = specUrlCandidates(BASE, "management");
    expect(specs).toEqual([
      `${BASE}/umbraco/openapi/management.json`,
      `${BASE}/umbraco/swagger/management/swagger.json`,
    ]);

    const ui = docsUiCandidates(BASE);
    expect(ui).toEqual([
      `${BASE}/umbraco/openapi/`,
      `${BASE}/umbraco/swagger/`,
    ]);

    const redirects = oauthRedirectCandidates(BASE);
    expect(redirects).toEqual([
      `${BASE}/umbraco/openapi/oauth2-redirect.html`,
      `${BASE}/umbraco/swagger/oauth2-redirect.html`,
    ]);
  });

  it("yields UI config sources for both conventions, openapi first", () => {
    const sources = uiConfigSources(BASE);
    expect(sources[0]).toBe(`${BASE}/umbraco/openapi/index.js`);
    expect(sources).toContain(`${BASE}/umbraco/swagger/index.js`);
    // openapi group precedes swagger group
    expect(sources.indexOf(`${BASE}/umbraco/openapi/index.js`)).toBeLessThan(
      sources.indexOf(`${BASE}/umbraco/swagger/index.js`)
    );
  });

  it("normalizes trailing slashes on the base URL", () => {
    expect(specUrlCandidates(`${BASE}/`, "delivery")[0]).toBe(
      `${BASE}/umbraco/openapi/delivery.json`
    );
  });
});
