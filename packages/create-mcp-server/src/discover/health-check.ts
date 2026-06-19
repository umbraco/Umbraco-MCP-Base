import { docsUiCandidates } from "./api-spec-conventions.js";

export interface HealthCheckResult {
  healthy: boolean;
  error?: string;
}

export async function checkHealth(baseUrl: string): Promise<HealthCheckResult> {
  // Umbraco 18+ serves the API docs UI at /umbraco/openapi/; Umbraco 17 and
  // earlier at /umbraco/swagger/. docsUiCandidates() probes openapi first.
  const uiUrls = docsUiCandidates(baseUrl);

  let lastStatus: number | undefined;
  try {
    for (const uiUrl of uiUrls) {
      const response = await fetch(uiUrl, {
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        return { healthy: true };
      }

      lastStatus = response.status;
    }

    return {
      healthy: false,
      error: `API documentation UI returned HTTP ${lastStatus}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("ECONNREFUSED")) {
      return {
        healthy: false,
        error: `Could not connect to ${baseUrl}. Is the Umbraco instance running?`,
      };
    }

    if (message.includes("timeout") || message.includes("abort")) {
      return {
        healthy: false,
        error: `Connection to ${baseUrl} timed out after 10 seconds.`,
      };
    }

    return { healthy: false, error: message };
  }
}
