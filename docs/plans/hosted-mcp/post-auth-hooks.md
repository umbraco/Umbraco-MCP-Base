# Post-Auth Hooks

## Problem

After a successful OAuth flow, operators may need to perform additional actions: logging authentication events, enriching `AuthProps` with data from external systems, auditing access, or integrating with notification services. Currently there is no hook point for this.

## Proposed API

```typescript
export interface HostedMcpServerOptions {
  // ... existing options ...

  /** Called after successful OAuth completion, before redirecting to MCP client.
   *  Can modify props (e.g., add metadata) or perform side effects (logging).
   *  Throwing an error aborts the authorization and shows an error page. */
  onAuthSuccess?: (context: AuthSuccessContext) => Promise<AuthProps> | AuthProps;
}

export interface AuthSuccessContext {
  /** The auth props that will be stored */
  props: AuthProps;
  /** The Cloudflare Worker environment */
  env: HostedMcpEnv;
  /** The original request */
  request: Request;
  /** The Umbraco auth request */
  authRequest: OAuthAuthRequest;
}
```

## Example Usage

```typescript
const options: HostedMcpServerOptions = {
  // ...
  onAuthSuccess: async ({ props, env }) => {
    // Log the authentication event
    await env.AUDIT_LOG.put(
      `auth:${Date.now()}`,
      JSON.stringify({
        userId: props.userId,
        userName: props.userName,
        timestamp: new Date().toISOString(),
      })
    );

    // Enrich props with additional metadata
    return {
      ...props,
      department: await lookupUserDepartment(props.userId),
    };
  },
};
```

## Considerations

- The hook runs in the critical auth path — performance matters. Consider a timeout.
- Errors in the hook should abort authorization and show a user-friendly error.
- The hook receives the full env so it can access KV, D1, or other bindings.
- Props returned from the hook replace the original props, so the hook must spread existing props.
- Consider a corresponding `onAuthFailure` hook for logging failed attempts.
- Document that the hook should not store secrets in props (props flow to the MCP client's token metadata).
