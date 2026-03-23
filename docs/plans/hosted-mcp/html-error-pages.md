# HTML Error Pages

## Problem

Currently, error responses (authorization failures, invalid callbacks, 404s) are returned as raw JSON. This is jarring for end users who see these errors in their browser during the OAuth flow. Error pages should match the consent screen design for a consistent experience.

## Proposed API

```typescript
export interface HostedMcpServerOptions {
  // ... existing options ...

  /** Override error page rendering.
   *  Receives error context and should return an HTML string.
   *  Falls back to built-in styled error page when not provided. */
  renderErrorPage?: (context: ErrorPageContext) => string;
}

export interface ErrorPageContext {
  /** HTTP status code */
  statusCode: number;
  /** Error title (e.g., "Authorization Failed") */
  title: string;
  /** Error description */
  message: string;
  /** Server name for branding */
  serverName?: string;
  /** Whether to show a "try again" link */
  showRetry?: boolean;
  /** URL to retry if applicable */
  retryUrl?: string;
}
```

## Example Usage

```typescript
const options: HostedMcpServerOptions = {
  // ...
  renderErrorPage: (ctx) => `
    <html>
      <body>
        <h1>${ctx.statusCode}: ${ctx.title}</h1>
        <p>${ctx.message}</p>
        ${ctx.showRetry ? `<a href="${ctx.retryUrl}">Try again</a>` : ''}
      </body>
    </html>
  `,
};
```

## Considerations

- Built-in error pages should reuse the same CSS as the consent screen for visual consistency.
- Error responses should still include appropriate HTTP status codes and security headers.
- Sensitive error details (stack traces, internal state) must never be exposed in error pages.
- Consider different error categories: auth errors (400), not found (404), server errors (500).
