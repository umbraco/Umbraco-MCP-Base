# Custom Landing Page

## Problem

The built-in landing page shows basic server info (name, version, MCP endpoint, Umbraco instance). Operators may want to display additional information, branding, documentation links, or a completely custom layout — particularly for multi-site deployments where the landing page serves as a directory.

## Proposed API

```typescript
export interface HostedMcpServerOptions {
  // ... existing options ...

  /** Override the landing page rendering.
   *  Receives context about the server and should return an HTML string.
   *  Falls back to the built-in landing page when not provided. */
  renderLandingPage?: (context: LandingPageContext) => string;
}

export interface LandingPageContext {
  /** Server display name */
  serverName: string;
  /** Server version */
  version: string;
  /** MCP endpoint path */
  mcpEndpoint: string;
  /** Umbraco base URL (single-site) or undefined (multi-site) */
  umbracoBaseUrl?: string;
  /** Multi-site config if configured */
  multiSite?: MultiSiteConfig;
  /** The Worker's origin URL */
  origin: string;
}
```

## Example Usage

```typescript
const options: HostedMcpServerOptions = {
  name: "Contoso MCP",
  version: "1.0.0",
  collections,
  modeRegistry,
  allModeNames,
  allSliceNames,
  renderLandingPage: (ctx) => `
    <html>
      <body>
        <h1>${ctx.serverName}</h1>
        <p>Connect your AI assistant to ${ctx.mcpEndpoint}</p>
        <p><a href="/docs">Documentation</a></p>
      </body>
    </html>
  `,
};
```

## Considerations

- The callback should receive enough context to render useful information without needing to access env bindings directly.
- HTML escaping is the operator's responsibility when using `renderLandingPage`.
- Security headers (X-Frame-Options, CSP) should still be applied by the framework regardless of custom rendering.
- Consider providing a `defaultLandingPageHtml(context)` export so operators can extend rather than replace.
