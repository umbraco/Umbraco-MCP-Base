# Configurable Routes

## Problem

The current route paths (`/authorize`, `/callback`, `/`) are hardcoded. Some deployments may need different paths — for example, when running behind a reverse proxy that maps routes differently, or to avoid conflicts with existing application routes.

## Proposed API

```typescript
export interface HostedMcpServerOptions {
  // ... existing options ...

  /** Override default route paths */
  routes?: RouteConfig;
}

export interface RouteConfig {
  /** Path for the authorize endpoint (default: "/authorize") */
  authorize?: string;
  /** Path for the callback endpoint (default: "/callback") */
  callback?: string;
  /** Path for the MCP endpoint (default: "/mcp").
   *  Note: this must also match the OAuthProvider's apiRoute. */
  mcp?: string;
  /** Path for the landing page (default: "/") */
  landing?: string;
}
```

## Example Usage

```typescript
const options: HostedMcpServerOptions = {
  // ...
  routes: {
    authorize: "/auth/authorize",
    callback: "/auth/callback",
    mcp: "/api/mcp",
  },
};

// OAuthProvider must use the same MCP route:
export default new OAuthProvider({
  apiRoute: "/api/mcp",
  // ...
});
```

## Considerations

- The `apiRoute` in OAuthProvider and the `routes.mcp` must match — document this clearly.
- Multi-site route patterns would need to incorporate the custom base paths (e.g., `/auth/authorize/:siteId`).
- The callback URL sent to Umbraco must use the configured callback path.
- Default values should remain as they are today for backwards compatibility.
- Consider validation to reject routes that would conflict (e.g., both authorize and callback at the same path).
