/**
 * Per-Client Consent Screen
 *
 * MANDATORY per MCP Authorization spec to prevent Confused Deputy attacks.
 * Before redirecting to Umbraco for authentication, the user must see
 * which MCP client is requesting access and consent to the authorization.
 */

export interface ConsentScreenOptions {
  /** The MCP client's display name or client_id */
  clientName: string;
  /** The Umbraco instance URL being accessed */
  umbracoBaseUrl: string;
  /** Requested OAuth scopes */
  scopes: string[];
  /** The registered redirect URI for this client */
  redirectUri: string;
  /** URL to submit the consent form to (the Worker's authorize endpoint) */
  actionUrl: string;
  /** CSRF state parameter to include in the form */
  state: string;
}

/**
 * Renders an HTML consent screen identifying the requesting MCP client.
 *
 * Security properties:
 * - Identifies the requesting MCP client by name
 * - Shows which Umbraco instance will be accessed
 * - Displays requested scopes
 * - Shows the registered redirect_uri
 * - CSRF protection via state parameter in hidden form field
 * - Prevents iframing (headers set by caller: X-Frame-Options: DENY)
 * - frame-ancestors CSP set by caller
 *
 * @param options - Consent screen configuration
 * @returns HTML string for the consent page
 */
export function renderConsentScreen(options: ConsentScreenOptions): string {
  const { clientName, umbracoBaseUrl, scopes, redirectUri, actionUrl, state } =
    options;

  const scopeList = scopes.length > 0
    ? scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join("")
    : "<li>Default access</li>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize MCP Client</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      max-width: 480px;
      width: 100%;
      padding: 2rem;
    }
    h1 { font-size: 1.25rem; margin-bottom: 1.5rem; color: #1b264f; }
    .field { margin-bottom: 1rem; }
    .field-label { font-size: 0.75rem; text-transform: uppercase; color: #666; margin-bottom: 0.25rem; }
    .field-value { font-size: 0.95rem; color: #333; word-break: break-all; }
    .scopes { list-style: none; padding: 0; }
    .scopes li {
      background: #f0f0f0;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      display: inline-block;
      margin: 0.25rem 0.25rem 0.25rem 0;
      font-size: 0.85rem;
    }
    .actions { margin-top: 1.5rem; display: flex; gap: 0.75rem; }
    button {
      flex: 1;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.95rem;
      cursor: pointer;
      border: 1px solid #ccc;
    }
    .btn-approve {
      background: #1b264f;
      color: white;
      border-color: #1b264f;
    }
    .btn-deny { background: white; color: #333; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize MCP Client</h1>

    <div class="field">
      <div class="field-label">Application</div>
      <div class="field-value">${escapeHtml(clientName)}</div>
    </div>

    <div class="field">
      <div class="field-label">Umbraco Instance</div>
      <div class="field-value">${escapeHtml(umbracoBaseUrl)}</div>
    </div>

    <div class="field">
      <div class="field-label">Requested Permissions</div>
      <ul class="scopes">${scopeList}</ul>
    </div>

    <div class="field">
      <div class="field-label">Redirect URI</div>
      <div class="field-value">${escapeHtml(redirectUri)}</div>
    </div>

    <form method="POST" action="${escapeHtml(actionUrl)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <div class="actions">
        <button type="submit" name="action" value="approve" class="btn-approve">Approve</button>
        <button type="submit" name="action" value="deny" class="btn-deny">Deny</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Returns a Response with the consent screen HTML and security headers.
 */
export function consentResponse(options: ConsentScreenOptions): Response {
  return new Response(renderConsentScreen(options), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
