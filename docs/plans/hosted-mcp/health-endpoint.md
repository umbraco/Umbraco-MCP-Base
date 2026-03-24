# Health Endpoint

## Problem

Hosted MCP servers need monitoring and health checks for production deployments. Load balancers, uptime monitors, and orchestration systems need a lightweight endpoint to verify the server is running and can reach its dependencies.

## Proposed API

```typescript
export interface HostedMcpServerOptions {
  // ... existing options ...

  /** Enable the /health endpoint (default: false) */
  enableHealthEndpoint?: boolean;

  /** Custom health check function.
   *  Return a HealthStatus object. Throwing means unhealthy. */
  healthCheck?: (env: HostedMcpEnv) => Promise<HealthStatus>;
}

export interface HealthStatus {
  /** Overall status */
  status: "healthy" | "degraded" | "unhealthy";
  /** Server version */
  version: string;
  /** Individual component checks */
  checks?: Record<string, {
    status: "pass" | "fail";
    message?: string;
  }>;
}
```

## Example Usage

```typescript
const options: HostedMcpServerOptions = {
  // ...
  enableHealthEndpoint: true,
  healthCheck: async (env) => {
    const kvOk = await checkKvAccess(env.OAUTH_KV);
    const umbracoOk = await checkUmbracoReachable(env.UMBRACO_BASE_URL);

    return {
      status: kvOk && umbracoOk ? "healthy" : "degraded",
      version: "1.0.0",
      checks: {
        kv: { status: kvOk ? "pass" : "fail" },
        umbraco: {
          status: umbracoOk ? "pass" : "fail",
          message: umbracoOk ? undefined : "Umbraco unreachable",
        },
      },
    };
  },
};
```

The endpoint would respond at `GET /health`:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "checks": {
    "kv": { "status": "pass" },
    "umbraco": { "status": "pass" }
  }
}
```

## Considerations

- The default health check (without custom `healthCheck`) should return basic server info and a 200 status.
- Health endpoints must not require authentication.
- Consider rate limiting to prevent abuse.
- Use standard HTTP status codes: 200 for healthy, 503 for unhealthy, 207 for degraded.
- The response format could follow the IETF Health Check Response Format (RFC draft).
- For multi-site deployments, consider per-site health checks (e.g., `/health/prod`, `/health/staging`).
- Be careful not to leak sensitive information (internal URLs, error details) in health responses.
