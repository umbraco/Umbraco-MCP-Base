# Consent Screen Branding

## Problem

Operators can customize the consent screen with `customCss`, but simple theming (logo, brand colour, name) requires writing CSS from scratch. Quick theming options would make consent screen customization more accessible.

## Proposed API

```typescript
export interface UmbracoAuthHandlerOptions {
  // ... existing options ...

  /** URL of the server/brand logo to display on the consent screen */
  serverLogoUrl?: string;
  /** Primary brand colour (hex, e.g., "#1b264f") */
  brandColor?: string;
  /** Brand name shown alongside the logo */
  brandName?: string;
}
```

These would be passed through to `ConsentScreenOptions` and rendered by the built-in consent screen template.

## Example Usage

```typescript
const options: HostedMcpServerOptions = {
  // ...
  authOptions: {
    serverLogoUrl: "https://cdn.example.com/logo.svg",
    brandColor: "#e74c3c",
    brandName: "Contoso CMS",
  },
};
```

The consent screen would show:
- Logo image above the title
- Brand colour applied to the approve button, headings, and accents
- Brand name in the page title and header

## Considerations

- Logo URLs should be validated (HTTPS only) to prevent mixed content warnings.
- Brand colour should be applied via CSS custom properties for easy cascading.
- These options should work together with `customCss` (CSS custom properties allow overriding individual values).
- Consider accessibility: auto-calculate contrasting text colour from `brandColor`.
- Image loading errors should degrade gracefully (hide logo, show text fallback).
- `renderConsent` override takes priority — branding options are ignored when a custom renderer is provided.
