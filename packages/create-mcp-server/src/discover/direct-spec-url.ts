import type { SwaggerEndpoint } from "./discover-swagger.js";

export interface OpenApiUrlValidation {
  reachable: boolean;
  parseable: boolean;
  title?: string;
  error?: string;
}

/**
 * Fetch and sanity-check a user-supplied OpenAPI/Swagger spec URL.
 * Never throws — a validation failure (auth wall, non-JSON body, wrong
 * content) is reported so the caller can warn and continue rather than
 * block the flow, since the URL may be behind authentication the CLI
 * doesn't know how to satisfy.
 */
export async function validateOpenApiUrl(
  url: string
): Promise<OpenApiUrlValidation> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!response.ok) {
      return { reachable: false, parseable: false, error: `HTTP ${response.status}` };
    }

    let spec: unknown;
    try {
      spec = await response.json();
    } catch {
      return { reachable: true, parseable: false, error: "Response was not valid JSON" };
    }

    const doc = spec as { openapi?: string; swagger?: string; info?: { title?: string } };
    if (!doc.openapi && !doc.swagger) {
      return {
        reachable: true,
        parseable: false,
        error: "Response does not look like an OpenAPI/Swagger document",
      };
    }

    return { reachable: true, parseable: true, title: doc.info?.title };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, parseable: false, error: message };
  }
}

/**
 * Derive a short identifier from a spec URL for orval config naming, e.g.
 * ".../umbraco/openapi/forms.json" -> "forms",
 * ".../umbraco/swagger/forms/swagger.json" -> "forms".
 */
export function deriveApiNameFromSpecUrl(specUrl: string): string {
  try {
    const { pathname } = new URL(specUrl);
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";

    if (last.toLowerCase() === "swagger.json" && segments.length >= 2) {
      return segments[segments.length - 2];
    }

    return last.replace(/\.(json|yaml|yml)$/i, "") || "api";
  } catch {
    return "api";
  }
}

export function toDirectSwaggerEndpoint(url: string, title?: string): SwaggerEndpoint {
  return { url, name: title || deriveApiNameFromSpecUrl(url) };
}
