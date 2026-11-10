import { resolveStatusText } from "../status-text.js";
import { toProblemDetails } from "../api-call-helpers.js";

describe("resolveStatusText", () => {
  it("keeps statusText when present", () => {
    expect(resolveStatusText(404, "Custom Reason")).toBe("Custom Reason");
  });

  it.each([
    [400, "Bad Request"],
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [404, "Not Found"],
    [409, "Conflict"],
    [500, "Internal Server Error"],
    [502, "Bad Gateway"],
    [503, "Service Unavailable"],
  ])("falls back to the reason phrase for %i when statusText is empty (HTTP/2)", (status, phrase) => {
    expect(resolveStatusText(status, "")).toBe(phrase);
    expect(resolveStatusText(status, undefined)).toBe(phrase);
  });

  it("returns an empty string for an unknown code with no statusText", () => {
    expect(resolveStatusText(599, "")).toBe("");
  });
});

describe("toProblemDetails with empty statusText", () => {
  it("uses the reason phrase as the title for an empty body", () => {
    expect(toProblemDetails({ status: 404, statusText: "", data: {} })).toEqual({ status: 404, title: "Not Found" });
  });

  it("omits the title for an unknown code", () => {
    expect(toProblemDetails({ status: 599, statusText: "", data: null })).toEqual({ status: 599 });
  });
});
