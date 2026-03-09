/**
 * Per-Client Consent Screen
 *
 * MANDATORY per MCP Authorization spec to prevent Confused Deputy attacks.
 * Before redirecting to Umbraco for authentication, the user must see
 * which MCP client is requesting access and consent to the authorization.
 *
 * Supports optional tool selection (modes/collections) and multi-site display.
 */

// ============================================================================
// Types
// ============================================================================

export interface ConsentSliceOption {
  name: string;
  displayName: string;
  defaultSelected?: boolean;
}

export interface ConsentToolConfig {
  /** Available modes with nested collection detail */
  modes?: ConsentModeOption[];
  /** Available operation slices */
  slices?: ConsentSliceOption[];
  /** Whether to show read-only toggle */
  showReadOnlyToggle?: boolean;
}

export interface ConsentModeOption {
  name: string;
  displayName: string;
  description: string;
  collections: { name: string; displayName: string; description: string }[];
  /** Whether this mode is selected by default */
  defaultSelected?: boolean;
}

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
  /** Tool selection config — when provided, renders mode/collection checkboxes */
  toolConfig?: ConsentToolConfig;
  /** Server display name shown in the consent header */
  serverName?: string;
  /** Custom CSS to inject into the consent page */
  customCss?: string;
  /** Sites available for selection (multi-site display) */
  sites?: { id: string; displayName: string; baseUrl: string }[];
  /** Override the entire consent screen rendering */
  renderConsent?: (options: ConsentScreenOptions) => string;
  /** When true, show a "Log in as different user" button between Approve and Deny */
  showReauthButton?: boolean;
}

// ============================================================================
// Rendering
// ============================================================================

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
 * When `toolConfig` is provided, renders mode checkboxes and read-only toggle.
 * When `renderConsent` callback is provided, delegates to it.
 *
 * @param options - Consent screen configuration
 * @returns HTML string for the consent page
 */
export function renderConsentScreen(options: ConsentScreenOptions): string {
  // Allow complete override of rendering
  if (options.renderConsent) {
    return options.renderConsent(options);
  }

  const {
    clientName,
    umbracoBaseUrl,
    scopes,
    redirectUri,
    actionUrl,
    state,
    toolConfig,
    serverName,
    customCss,
    sites,
    showReauthButton,
  } = options;

  const scopeList = scopes.length > 0
    ? scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join("")
    : "<li>Default access</li>";

  const title = serverName
    ? `Authorize ${escapeHtml(serverName)}`
    : "Authorize MCP Client";

  const toolSelectionHtml = toolConfig ? renderToolSelection(toolConfig) : "";
  const siteSelectionHtml = sites && sites.length > 0 ? renderSiteSelection(sites) : "";
  const customCssBlock = customCss ? `<style>${customCss}</style>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
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
      max-width: 720px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: #1b264f;
      padding: 1.25rem 2rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .header svg { flex-shrink: 0; }
    .header h1 { font-size: 1.25rem; margin: 0; color: white; }
    .card-body { padding: 1.5rem 2rem 2rem; }
    .fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem 1.5rem; margin-bottom: 1rem; }
    @media (max-width: 600px) { .fields-grid { grid-template-columns: 1fr; } }
    .field { margin-bottom: 0; }
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
    .btn-reauth { background: white; color: #1b264f; border-color: #1b264f; }
    .tool-selection { margin-top: 1rem; border-top: 1px solid #eee; padding-top: 1rem; }
    .tool-selection h2 { font-size: 0.95rem; color: #1b264f; margin-bottom: 0.75rem; }
    .modes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1.5rem; }
    @media (max-width: 600px) { .modes-grid { grid-template-columns: 1fr; } }
    .mode-item { margin-bottom: 0.75rem; }
    .mode-item label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: #333; cursor: pointer; }
    .mode-item input[type="checkbox"] { accent-color: #1b264f; }
    .mode-description { font-size: 0.8rem; color: #888; margin-left: 1.5rem; }
    .mode-collections { margin-left: 1.5rem; margin-top: 0.25rem; display: none; }
    .mode-collections.visible { display: block; }
    .collection-item { margin-top: 0.25rem; }
    .collection-item label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #444; cursor: pointer; }
    .collection-item input[type="checkbox"] { accent-color: #1b264f; }
    .collection-description { font-size: 0.75rem; color: #999; margin-left: 0.25rem; }
    .collection-item input:disabled ~ .collection-description { color: #ccc; }
    .collection-item label:has(input:disabled) { color: #ccc; }
    .slice-selection { margin-top: 1rem; border-top: 1px solid #eee; padding-top: 1rem; }
    .slice-selection h2 { font-size: 0.95rem; color: #1b264f; margin-bottom: 0.75rem; }
    .slices-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem; }
    @media (max-width: 600px) { .slices-grid { grid-template-columns: repeat(3, 1fr); } }
    .slice-item { margin: 0; }
    .slice-item label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: #333; cursor: pointer; }
    .slice-item input[type="checkbox"] { accent-color: #1b264f; }
    .readonly-toggle { margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #eee; }
    .readonly-toggle label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: #333; cursor: pointer; }
    .site-selection { margin-bottom: 1rem; }
    .site-selection h2 { font-size: 0.75rem; text-transform: uppercase; color: #666; margin-bottom: 0.5rem; }
    .site-option { margin-bottom: 0.5rem; }
    .site-option label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: #333; cursor: pointer; padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid #eee; }
    .site-option label:hover { background: #f8f8ff; border-color: #1b264f; }
    .site-option input[type="radio"] { accent-color: #1b264f; }
    .site-option .site-url { font-size: 0.75rem; color: #888; }
  </style>
  ${customCssBlock}
</head>
<body>
  <div class="card">
    <div class="header">
      <svg width="28" height="28" viewBox="0 0 315.89 315.89" xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0 157.74a157.95 157.95 0 11158 158.15A157.95 157.95 0 010 157.74zm154.74 54.09a155.41 155.41 0 01-36.5-3.29 27.92 27.92 0 01-19.94-16q-5.35-12.34-5.21-38.1a243 243 0 011.69-26.84q1.55-13 3.09-21.46l1.07-5.59a2 2 0 000-.49 3.2 3.2 0 00-2.65-3.17l-20.37-3.22h-.44a3.19 3.19 0 00-3.11 2.48c-.35 1.31-.56 2.27-1.17 5.38-1.16 6-2.24 11.85-3.43 20.38a264.17 264.17 0 00-2.3 27.94 145.24 145.24 0 000 19.57q.72 25.94 8.9 41.42t27.72 22.3q19.53 6.81 54.43 6.66h2.91q34.94.15 54.41-6.66t27.71-22.3q8.17-15.53 8.91-41.42a145.24 145.24 0 000-19.57 266.84 266.84 0 00-2.3-27.94c-1.2-8.44-2.27-14.26-3.44-20.38-.61-3.11-.81-4.07-1.16-5.38a3.21 3.21 0 00-3.12-2.48h-.52l-20.38 3.18a3.2 3.2 0 00-2.68 3.17 4 4 0 000 .49l1.08 5.59q1.55 8.48 3.12 21.46a245.68 245.68 0 011.65 26.84q.27 25.69-5.21 38.07a27.9 27.9 0 01-19.76 16.07 155.19 155.19 0 01-36.48 3.29z"/></svg>
      <h1>${title}</h1>
    </div>
    <div class="card-body">

    <div class="fields-grid">
      <div class="field">
        <div class="field-label">Application</div>
        <div class="field-value">${escapeHtml(clientName)}</div>
      </div>

      ${sites && sites.length > 0 ? siteSelectionHtml : `<div class="field">
        <div class="field-label">Umbraco Instance</div>
        <div class="field-value">${escapeHtml(umbracoBaseUrl)}</div>
      </div>`}

      <div class="field">
        <div class="field-label">Requested Permissions</div>
        <ul class="scopes">${scopeList}</ul>
      </div>

      <div class="field">
        <div class="field-label">Redirect URI</div>
        <div class="field-value">${escapeHtml(redirectUri)}</div>
      </div>
    </div>

    <form method="POST" action="${escapeHtml(actionUrl)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      ${toolSelectionHtml}
      <div class="actions">
        <button type="submit" name="action" value="approve" class="btn-approve">Approve</button>${showReauthButton ? `
        <button type="submit" name="action" value="reauth" class="btn-reauth">Log in as different user</button>` : ""}
        <button type="submit" name="action" value="deny" class="btn-deny">Deny</button>
      </div>
    </form>
    </div>
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

// ============================================================================
// Internal Helpers
// ============================================================================

function renderToolSelection(config: ConsentToolConfig): string {
  const parts: string[] = [];

  if (config.modes && config.modes.length > 0) {
    parts.push(`<div class="tool-selection">`);
    parts.push(`<h2>Tool Modes</h2>`);
    parts.push(`<div class="modes-grid">`);

    for (const mode of config.modes) {
      const checked = mode.defaultSelected ? " checked" : "";
      const disabled = mode.defaultSelected ? "" : " disabled";
      const collectionChecked = mode.defaultSelected ? " checked" : "";

      parts.push(`<div class="mode-item" data-mode="${escapeHtml(mode.name)}">`);
      parts.push(
        `<label><input type="checkbox" name="selectedModes[]" value="${escapeHtml(mode.name)}"${checked} class="mode-checkbox"> ${escapeHtml(mode.displayName)}</label>`
      );
      if (mode.description) {
        parts.push(
          `<div class="mode-description">${escapeHtml(mode.description)}</div>`
        );
      }
      if (mode.collections.length > 0) {
        const visibleClass = mode.defaultSelected ? " visible" : "";
        parts.push(`<div class="mode-collections${visibleClass}">`);
        for (const col of mode.collections) {
          parts.push(`<div class="collection-item">`);
          parts.push(
            `<label><input type="checkbox" name="selectedCollections[]" value="${escapeHtml(col.name)}"${collectionChecked}${disabled} class="collection-checkbox"> ${escapeHtml(col.displayName)}</label>`
          );
          if (col.description) {
            parts.push(
              `<span class="collection-description">${escapeHtml(col.description)}</span>`
            );
          }
          parts.push(`</div>`);
        }
        parts.push(`</div>`);
      }
      parts.push(`</div>`);
    }

    parts.push(`</div>`); // close .modes-grid

    parts.push(`<script>
document.querySelectorAll('.mode-checkbox').forEach(function(modeCheckbox) {
  modeCheckbox.addEventListener('change', function() {
    var modeItem = this.closest('.mode-item');
    var collections = modeItem.querySelector('.mode-collections');
    if (collections) {
      if (modeCheckbox.checked) {
        collections.classList.add('visible');
      } else {
        collections.classList.remove('visible');
      }
    }
    var collectionCheckboxes = modeItem.querySelectorAll('.collection-checkbox');
    collectionCheckboxes.forEach(function(cb) {
      cb.disabled = !modeCheckbox.checked;
      cb.checked = modeCheckbox.checked;
    });
  });
});
</script>`);

    parts.push(`</div>`);
  }

  if (config.slices && config.slices.length > 0) {
    parts.push(`<div class="slice-selection">`);
    parts.push(`<h2>Operations</h2>`);
    parts.push(`<div class="slices-grid">`);

    for (const slice of config.slices) {
      const checked = slice.defaultSelected !== false ? " checked" : "";
      parts.push(`<div class="slice-item">`);
      parts.push(
        `<label><input type="checkbox" name="selectedSlices[]" value="${escapeHtml(slice.name)}"${checked} class="slice-checkbox"> ${escapeHtml(slice.displayName)}</label>`
      );
      parts.push(`</div>`);
    }

    parts.push(`</div>`); // close .slices-grid
    parts.push(`</div>`);
  }

  if (config.showReadOnlyToggle) {
    parts.push(`<div class="readonly-toggle">`);
    parts.push(
      `<label><input type="checkbox" name="readOnly" value="true"> Read-only mode (disable create, update, delete)</label>`
    );
    parts.push(`</div>`);
  }

  return parts.join("\n");
}

function renderSiteSelection(
  sites: { id: string; displayName: string; baseUrl: string }[]
): string {
  // Single site: hidden field (no need for user to choose)
  if (sites.length === 1) {
    const site = sites[0];
    return `<input type="hidden" name="siteId" value="${escapeHtml(site.id)}" />
    <div class="field">
      <div class="field-label">Umbraco Instance</div>
      <div class="field-value">${escapeHtml(site.displayName)} — ${escapeHtml(site.baseUrl)}</div>
    </div>`;
  }

  // Multiple sites: radio buttons
  const options = sites
    .map(
      (site, i) =>
        `<div class="site-option">
      <label><input type="radio" name="siteId" value="${escapeHtml(site.id)}"${i === 0 ? " checked" : ""}> ${escapeHtml(site.displayName)} <span class="site-url">${escapeHtml(site.baseUrl)}</span></label>
    </div>`
    )
    .join("\n");

  return `<div class="site-selection">
  <h2>Umbraco Instance</h2>
  ${options}
</div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
