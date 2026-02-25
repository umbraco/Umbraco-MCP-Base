export interface HealthCheckResult {
  healthy: boolean;
  error?: string;
}

export async function checkHealth(baseUrl: string): Promise<HealthCheckResult> {
  const swaggerUiUrl = `${baseUrl}/umbraco/swagger/`;

  try {
    const response = await fetch(swaggerUiUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return { healthy: true };
    }

    return {
      healthy: false,
      error: `Swagger UI returned HTTP ${response.status}`,
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
