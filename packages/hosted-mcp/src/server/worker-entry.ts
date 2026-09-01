/**
 * Worker Entry Point Helpers
 *
 * Provides the building blocks for creating a hosted Umbraco MCP Worker.
 *
 * The Worker entry point is defined in the consumer's worker.ts (built with wrangler)
 * because `agents/mcp` and `@cloudflare/workers-oauth-provider` are Wrangler virtual
 * modules that are only available at wrangler build time.
 *
 * This module provides:
 * - Type definitions for the Worker options
 * - The default handler (authorize, callback, landing page)
 * - Multi-site routing
 * - Helper to wire everything together
 */

import type {
  ToolCollectionExport,
  ToolModeDefinition,
} from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import type {
  MultiSiteConfig,
  SiteRoutingConfig,
} from "../types/multi-site.js";
import type { AuthProps, UmbracoAuthHandlerOptions } from "../types/auth.js";
import { createSiteRouter } from "../site-routing/site-router.js";
import {
  matchTenantOAuthPath,
  dispatchTenantOAuth,
} from "../tenant-oauth/tenant-router.js";
import {
  createAuthorizeHandler,
  createCallbackHandler,
  createLogoutCallbackHandler,
} from "../auth/umbraco-handler.js";
import type { ConsentModeOption, ConsentToolConfig } from "../auth/consent.js";
import {
  type CreateServerOptions,
  type InstructionsResolver,
  type SiteResolver,
} from "./create-server.js";
import { loadWorkerConfig } from "../config/worker-config.js";

/**
 * Configuration for a chained MCP server's consent screen integration.
 * Provides the metadata needed to show chained server modes on the consent screen.
 */
export interface ChainedServerConsentConfig {
  /** Prefix used for tool names and mode values (e.g., "demo") */
  name: string;
  /** Display name shown as consent section header (e.g., "Demo Add-On") */
  displayName: string;
  /** Mode definitions from the chained server */
  modeRegistry: ToolModeDefinition[];
  /** Tool collections from the chained server */
  collections: ToolCollectionExport[];
  /** All valid mode names from the chained server */
  allModeNames: readonly string[];
  /** All valid slice names from the chained server */
  allSliceNames: readonly string[];
}

/**
 * Options for creating a hosted MCP server Worker.
 */
export interface HostedMcpServerOptions {
  /** Server name (displayed to MCP clients) */
  name: string;
  /** Server version */
  version: string;
  /** Tool collections to expose */
  collections: ToolCollectionExport[];
  /** Mode registry for tool filtering */
  modeRegistry: ToolModeDefinition[];
  /** All valid mode names */
  allModeNames: readonly string[];
  /** All valid slice names */
  allSliceNames: readonly string[];
  /** Optional factory to create the API client (see CreateServerOptions.clientFactory) */
  clientFactory?: () => unknown;
  /**
   * Optional server-level instructions sent to clients on `initialize`.
   * See `CreateServerOptions.instructions` for details.
   */
  instructions?: InstructionsResolver;
  /** Umbraco OAuth handler options */
  authOptions?: UmbracoAuthHandlerOptions;
  /** Enable tool selection on consent screen (auto-generates from mode registry) */
  enableConsentToolSelection?: boolean;
  /** Multi-site deployment configuration (static list with consent-screen picker). */
  multiSite?: MultiSiteConfig;
  /** Dynamic site resolver for URL-based site routing.
   *  See CreateServerOptions.resolveSite for details. */
  resolveSite?: SiteResolver;
  /**
   * URL-based site routing — encodes the target site in the MCP endpoint URL
   * (e.g. `/at/{alias}/`) instead of asking the user to pick on the consent screen.
   *
   * Mutually exclusive with `multiSite`. When provided, supersedes `resolveSite`
   * for both the worker entry rewrite and per-request site lookup.
   */
  siteRouting?: SiteRoutingConfig;
  /** Chained MCP servers to include on consent screen and /info endpoint */
  chainedServers?: ChainedServerConsentConfig[];
  /** Umbraco major this server's tools target (see CreateServerOptions.expectedUmbracoMajor) */
  expectedUmbracoMajor?: string;
  /**
   * Opt into OpenTelemetry tracing for tool calls — see
   * `CreateServerOptions.telemetry`. Pass the `tracing` object from
   * `cloudflare:workers`, which only the consumer can import.
   *
   * ```ts
   * import { tracing } from "cloudflare:workers";
   * const options: HostedMcpServerOptions = { name, version, collections, telemetry: { tracing } };
   * ```
   */
  telemetry?: CreateServerOptions["telemetry"];
}

/**
 * Extracts CreateServerOptions from HostedMcpServerOptions.
 * Used internally to pass to createPerRequestServer.
 *
 * Throws when mutually-exclusive site configurations are combined.
 *
 * **This is an explicit whitelist, not a spread.** Every field a consumer can
 * set has to be copied across by name, so a new option added to
 * `CreateServerOptions` is silently dropped here until it is added below. That
 * is how `telemetry` shipped inert in 1.0.0-beta.36 — the template set it on
 * `options`, this function discarded it, and nothing failed: the object still
 * type-checked and no test covered the path. If you add an option, add it here
 * and assert it in `worker-entry.test.ts`.
 */
export function getServerOptions(
  options: HostedMcpServerOptions
): CreateServerOptions {
  if (options.siteRouting && options.multiSite) {
    throw new Error(
      "siteRouting and multiSite are mutually exclusive — choose one."
    );
  }

  return {
    name: options.name,
    version: options.version,
    collections: options.collections,
    modeRegistry: options.modeRegistry,
    allModeNames: options.allModeNames,
    allSliceNames: options.allSliceNames,
    clientFactory: options.clientFactory,
    multiSite: options.multiSite,
    resolveSite: options.siteRouting?.resolveSite ?? options.resolveSite,
    instructions: options.instructions,
    expectedUmbracoMajor: options.expectedUmbracoMajor,
    telemetry: options.telemetry,
  };
}

/**
 * Auto-generates ConsentToolConfig from the mode registry and collections.
 *
 * Maps each mode to its display info and the collections it contains,
 * with all modes selected by default.
 */
export function buildConsentToolConfig(
  options: HostedMcpServerOptions
): ConsentToolConfig | undefined {
  if (!options.enableConsentToolSelection) return undefined;

  // Main server modes
  const modes: ConsentModeOption[] = options.modeRegistry.map((m) => ({
    name: m.name,
    displayName: m.displayName,
    description: m.description,
    collections: options.collections
      .filter((c) => m.collections.includes(c.metadata.name))
      .map((c) => ({
        name: c.metadata.name,
        displayName: c.metadata.displayName,
        description: c.metadata.description,
      })),
    defaultSelected: false,
  }));

  // Append chained server modes with prefixed names
  if (options.chainedServers) {
    for (const chained of options.chainedServers) {
      for (const m of chained.modeRegistry) {
        modes.push({
          name: `${chained.name}:${m.name}`,
          displayName: m.displayName,
          description: m.description,
          collections: chained.collections
            .filter((c) => m.collections.includes(c.metadata.name))
            .map((c) => ({
              name: `${chained.name}:${c.metadata.name}`,
              displayName: c.metadata.displayName,
              description: c.metadata.description,
            })),
          defaultSelected: false,
          group: chained.displayName,
        });
      }
    }
  }

  // Collect and deduplicate slices from main server and all chained servers
  const sliceSet = new Set<string>();
  for (const s of options.allSliceNames) {
    if (s !== "other") sliceSet.add(s);
  }
  if (options.chainedServers) {
    for (const chained of options.chainedServers) {
      for (const s of chained.allSliceNames) {
        if (s !== "other") sliceSet.add(s);
      }
    }
  }

  return {
    modes,
    slices: [...sliceSet].map((s) => ({
      name: s,
      displayName: s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " "),
      defaultSelected: true,
    })),
    showReadOnlyToggle: true,
  };
}

/**
 * Creates the default handler for non-MCP routes.
 *
 * Handles:
 * - `/authorize` (or `/authorize/:siteId`) - Consent screen + Umbraco redirect
 * - `/callback` (or `/callback/:siteId`) - Token exchange + MCP client redirect
 * - `/` - Landing page with server info (or site listing for multi-site)
 *
 * This is used as the `defaultHandler` in the OAuthProvider config.
 * Returns an ExportedHandler-compatible object with a `fetch` method,
 * as required by @cloudflare/workers-oauth-provider.
 *
 * @param options - Server configuration
 * @returns ExportedHandler object for non-MCP routes
 */
export function createDefaultHandler(options: HostedMcpServerOptions) {
  return {
    async fetch(request: Request, env: HostedMcpEnv): Promise<Response> {
      // Resolve enableConsentToolSelection: explicit option wins, then env var fallback
      const enableConsent = options.enableConsentToolSelection
        ?? env.ENABLE_CONSENT_TOOL_SELECTION === "true";
      const optionsWithConsent = enableConsent
        ? { ...options, enableConsentToolSelection: true }
        : options;

      // Build consent tool config (only if enableConsentToolSelection resolved to true)
      const consentToolConfig = buildConsentToolConfig(optionsWithConsent);

      // URL-based site routing has an optional runtime gate so consumers
      // (and the Umbraco Cloud preset) can flip the mode per-request without
      // module-scope env access. When `siteRouting.enabled` is missing the
      // routing is always-on; the Cloud preset defaults `enabled` to read
      // `env.UMBRACO_CLOUD_ROUTING_ENABLED`. When the gate returns false,
      // treat the worker as single-tenant — don't expose `siteRouting` to
      // the authorize handler or downstream routing.
      const effectiveSiteRouting =
        options.siteRouting && (options.siteRouting.enabled?.(env) ?? true)
          ? options.siteRouting
          : undefined;
      const effectiveOptions: HostedMcpServerOptions = {
        ...options,
        siteRouting: effectiveSiteRouting,
      };

      // Merge auto-generated tool config and multi-site config into auth options.
      // Use the server name as the consent screen server name if not explicitly set.
      const effectiveAuthOptions: UmbracoAuthHandlerOptions = {
        serverName: options.name,
        ...options.authOptions,
        ...(consentToolConfig ? { consentToolConfig } : {}),
        ...(options.multiSite ? { sites: options.multiSite.sites } : {}),
        ...(effectiveSiteRouting ? { siteRouting: effectiveSiteRouting } : {}),
      };

      return handleDefaultRequest(request, env, effectiveOptions, effectiveAuthOptions);
    },
  };
}

/**
 * OAuthProvider fetch interface (subset used by createWorkerExport).
 */
interface OAuthProviderLike {
  fetch(request: Request, env: HostedMcpEnv, ctx: ExecutionContext): Promise<Response>;
}

/**
 * Creates the Worker export that wraps OAuthProvider with URL rewriting.
 *
 * OAuthProvider uses `pathname.startsWith(apiRoute)` to match the MCP
 * endpoint. Setting `apiRoute: "/"` would match ALL paths, breaking
 * OAuth endpoints. So we keep `apiRoute: "/mcp"` internally and rewrite
 * incoming requests to `/` → `/mcp` before passing to OAuthProvider.
 *
 * - **Browser GET to `/`** (no auth header, not SSE) → serve landing page
 * - **MCP request to `/`** (POST, GET+SSE, DELETE with auth) → rewrite to `/mcp`
 * - **Everything else** (`/authorize`, `/callback`, `/info`, etc.) → pass through
 *
 * @param oauthProvider - The OAuthProvider instance (apiRoute must be "/mcp")
 * @param options - Server configuration (used for landing page rendering)
 */
export function createWorkerExport(
  oauthProvider: OAuthProviderLike,
  options: HostedMcpServerOptions,
) {
  // Validate mutual exclusivity early — fail at boot, not at first request.
  if (options.siteRouting && options.multiSite) {
    throw new Error(
      "siteRouting and multiSite are mutually exclusive — choose one."
    );
  }

  // When URL-based site routing is configured, build a router that VALIDATES
  // the site (returns 404 / 502 for unknown / errored siteIds) and passes the
  // original request through to OAuthProvider unchanged. The URL must reach
  // OAuthProvider with the `/{pathPrefix}/{siteId}` path intact so the
  // resource-indicator audience check on the issued access token validates
  // correctly. The consumer's `apiHandler` does the internal `/at/<alias>/` →
  // `/mcp` rewrite after token validation.
  const siteRouter = options.siteRouting
    ? createSiteRouter(
        options.siteRouting,
        {},
        async (request, env, ctx) => oauthProvider.fetch(request, env, ctx)
      )
    : null;

  // Wrap OAuthProvider so 401s on `/at/<alias>/...` paths get their
  // `resource_metadata` URL rewritten to the tenant PRM. OAuthProvider builds
  // the URL from `url.origin` only — the root PRM — which never enters the
  // tenant-pinned discovery chain. (Issue #103.)
  const fetchOAuth = async (
    request: Request,
    env: HostedMcpEnv,
    ctx: ExecutionContext,
  ): Promise<Response> => {
    const response = await oauthProvider.fetch(request, env, ctx);
    if (response.status === 401) {
      return rewriteWwwAuthenticateForTenant(response, request);
    }
    return response;
  };

  return {
    async fetch(request: Request, env: HostedMcpEnv, ctx: ExecutionContext): Promise<Response> {
      let url = new URL(request.url);

      // Proxies/tunnels (cloudflared) hop to the worker over plain HTTP, but
      // OAuthProvider derives discovery URLs from the request origin — so
      // upgrade the protocol when x-forwarded-proto says https.
      if (
        request.headers.get("x-forwarded-proto") === "https" &&
        url.protocol === "http:"
      ) {
        url.protocol = "https:";
        request = new Request(url.toString(), request);
        url = new URL(request.url);
      }

      const pathname = url.pathname;

      // URL-based site routing has an optional runtime gate
      // (`siteRouting.enabled`) so the mode can flip at deploy time without
      // module-scope env access. `siteRouter` itself is built eagerly from
      // compile-time `options.siteRouting`; the runtime gate lives at the
      // call site so `/at/*` requests fall through to OAuthProvider (which
      // 401s unauthenticated requests) when off. Always-on by default; the
      // Umbraco Cloud preset wires this to `env.UMBRACO_CLOUD_ROUTING_ENABLED`.
      const siteRoutingEnabled =
        options.siteRouting?.enabled?.(env) ?? Boolean(options.siteRouting);
      const useSiteRouter = Boolean(siteRouter && siteRoutingEnabled);

      if (useSiteRouter) {
        // 1. Tenant-OAuth paths (authorize/token/register/callback + new
        //    per-tenant well-known + per-tenant PRM) are intercepted before
        //    OAuthProvider sees them. Issue #100 — per-tenant DCR, audience
        //    synthesis, confused-deputy defence.
        const tenantMatch = matchTenantOAuthPath(pathname);
        if (tenantMatch) {
          return dispatchTenantOAuth(
            tenantMatch,
            request,
            env,
            ctx,
            options.siteRouting!,
            oauthProvider
          );
        }

        // 2. Disable root /register under siteRouting. Per-tenant DCR is the
        //    only legitimate registration path; root /register would produce
        //    tenant-unbound clients that fail every authorize request.
        if (pathname === "/register") {
          return new Response(
            JSON.stringify({
              error: "registration_disabled",
              error_description: "Use /at/<alias>/register",
            }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        // 2a. Disable root /.well-known/oauth-authorization-server under
        //    siteRouting. The root document advertises `registration_endpoint`
        //    as root /register (because OAuthProvider builds it from
        //    `url.origin` only), which we've just 404'd above. Clients that
        //    skip the `WWW-Authenticate.resource_metadata` chain and walk root
        //    discovery directly land there and fail dynamic client
        //    registration with no recovery path. Returning 404 here forces
        //    them onto the spec-compliant resource_metadata flow, which
        //    yields the per-tenant authz-server URL that *does* work.
        //    Spec-compliant clients are unaffected — they never read root
        //    metadata to begin with.
        if (pathname === "/.well-known/oauth-authorization-server") {
          return new Response(
            JSON.stringify({
              error: "not_supported",
              error_description:
                "This server is multi-tenant. Resolve the per-tenant authorization-server URL via the `resource_metadata` field of the 401 WWW-Authenticate header on the protected MCP endpoint, then read /.well-known/oauth-authorization-server/at/<alias> (or /at/<alias>/.well-known/oauth-authorization-server).",
            }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        // 3. Legacy PRM handler — kept as a fallback for clients that walk
        //    the prefix-matched path even though the canonical PRM is now
        //    served by the tenant-OAuth dispatcher above. Both emit the same
        //    tenant-pinned authorization_servers value.
        const opmPrefix = "/.well-known/oauth-protected-resource";
        if (pathname.startsWith(opmPrefix + "/")) {
          const resourcePath = pathname.slice(opmPrefix.length);
          if (siteRouter!.prefixRegex.test(resourcePath)) {
            return renderProtectedResourceMetadata(request, url, resourcePath);
          }
        }

        // 4. /at/<alias>/mcp — siteRouter validates + forwards to OAuthProvider
        //    with the path intact for audience-claim validation.
        if (siteRouter!.prefixRegex.test(pathname)) {
          return siteRouter!.fetch(request, env, ctx);
        }
      }

      if (pathname === "/") {
        const hasAuth = request.headers.has("Authorization");
        const acceptsSSE = request.headers.get("Accept")?.includes("text/event-stream");

        // Browser visit: plain GET with no auth and not SSE → landing page
        if (request.method === "GET" && !hasAuth && !acceptsSSE) {
          if (options.siteRouting && siteRoutingEnabled) {
            return renderSiteRoutingLandingResponse(
              options.name,
              options.version,
              options.siteRouting.pathPrefix
            );
          }
          if (options.multiSite) {
            return renderMultiSiteLandingResponse(options.name, options.version, options.multiSite);
          }
          return renderLandingPageResponse(options.name, options.version, env.UMBRACO_BASE_URL);
        }

        // MCP request: rewrite / → /mcp so OAuthProvider routes it correctly
        url.pathname = "/mcp";
        return fetchOAuth(new Request(url.toString(), request), env, ctx);
      }

      // All other paths pass through to OAuthProvider unchanged
      return fetchOAuth(request, env, ctx);
    },
  };
}

/**
 * Patches the `resource_metadata` URL in a 401 response's `WWW-Authenticate`
 * header so it points at the tenant-pinned PRM URL when the request was for a
 * `/at/<alias>/...` path.
 *
 * `@cloudflare/workers-oauth-provider` builds the URL from `url.origin` only,
 * which yields the root PRM (`<origin>/.well-known/oauth-protected-resource`)
 * regardless of request path. Without this rewrite, clients walk root
 * discovery, get root `authorization_servers`, and fail at root `/register`
 * (which we 404 under site routing). Issue #103.
 */
function rewriteWwwAuthenticateForTenant(
  response: Response,
  request: Request,
): Response {
  const wwwAuth = response.headers.get("www-authenticate");
  if (!wwwAuth) return response;

  const url = new URL(request.url);
  const tenantMatch = url.pathname.match(/^\/at\/([^/]+)\//);
  if (!tenantMatch) return response;
  const alias = tenantMatch[1];

  const rootPrmUrl = `${url.origin}/.well-known/oauth-protected-resource`;
  const tenantPrmUrl = `${url.origin}/.well-known/oauth-protected-resource/at/${alias}`;
  const rewritten = wwwAuth.replace(
    `resource_metadata="${rootPrmUrl}"`,
    `resource_metadata="${tenantPrmUrl}"`,
  );
  if (rewritten === wwwAuth) return response;

  const newHeaders = new Headers(response.headers);
  newHeaders.set("www-authenticate", rewritten);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// ============================================================================
// Internal Route Handling
// ============================================================================

async function handleDefaultRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions,
  effectiveAuthOptions: UmbracoAuthHandlerOptions
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // URL-based site routing — uses the same /callback/:siteId pattern as multi-site
  // since the OAuth callback handling is identical.
  if (options.siteRouting) {
    return handleSiteRoutingRequest(request, env, options, effectiveAuthOptions, path);
  }

  // Multi-site routing
  if (options.multiSite) {
    return handleMultiSiteRequest(request, env, options, effectiveAuthOptions, path);
  }

  // Single-site routing
  return handleSingleSiteRequest(request, env, options, effectiveAuthOptions, path);
}

async function handleSingleSiteRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions,
  authOptions: UmbracoAuthHandlerOptions,
  path: string,
): Promise<Response> {
  // Handle MCP client authorization (consent screen + redirect to Umbraco)
  if (path === "/authorize") {
    return handleAuthorize(request, env, authOptions);
  }

  // Handle Umbraco OAuth callback — exchange code, then complete MCP auth
  if (path === "/callback") {
    return handleCallback(request, env);
  }

  // Handle logout callback (reauth flow: Umbraco signout redirects here)
  if (path === "/logout-callback") {
    return handleLogoutCallback(request, env);
  }

  // Diagnostic endpoint (dev-only)
  if (path === "/info" && env.ENABLE_INFO_ENDPOINT === "true") {
    return renderInfoResponse(options, env);
  }

  return new Response("Not Found", { status: 404 });
}

async function handleMultiSiteRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions,
  authOptions: UmbracoAuthHandlerOptions,
  path: string,
): Promise<Response> {
  const multiSite = options.multiSite!;

  // Authorize — single endpoint, consent form includes site picker.
  // Site selection happens in the consent form, not via separate /authorize/:siteId
  // endpoints, because MCP OAuth discovery only supports a single authorization_endpoint.
  if (path === "/authorize") {
    return handleAuthorize(request, env, authOptions);
  }

  // Callback — match /callback/:siteId for multi-site.
  // The siteId in the path matches what was registered as the redirect_uri with
  // Umbraco during authorize. Site-specific credentials are stored in KV state
  // and consumed by the callback handler directly — no env overlay needed.
  const callbackMatch = path.match(/^\/callback\/([^/]+)$/);
  if (callbackMatch) {
    const siteId = callbackMatch[1];
    const site = multiSite.sites.find((s) => s.id === siteId);
    if (!site) {
      return new Response(JSON.stringify({ error: `Unknown site: ${siteId}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handleCallback(request, env);
  }

  // Also handle /callback without siteId (fallback)
  if (path === "/callback") {
    return handleCallback(request, env);
  }

  // Handle logout callback (reauth flow: Umbraco signout redirects here)
  if (path === "/logout-callback") {
    return handleLogoutCallback(request, env);
  }

  // Diagnostic endpoint (dev-only)
  if (path === "/info" && env.ENABLE_INFO_ENDPOINT === "true") {
    return renderMultiSiteInfoResponse(options, env, multiSite);
  }

  return new Response("Not Found", { status: 404 });
}

async function handleSiteRoutingRequest(
  request: Request,
  env: HostedMcpEnv,
  options: HostedMcpServerOptions,
  authOptions: UmbracoAuthHandlerOptions,
  path: string,
): Promise<Response> {
  // Authorize — site is determined by the OAuth `resource` parameter, not a picker.
  if (path === "/authorize") {
    return handleAuthorize(request, env, authOptions);
  }

  // Callback — `/callback/:siteId` mirrors the multi-site shape; the siteId
  // came from the resource parameter and was used as the redirect_uri suffix
  // when redirecting to Umbraco. No need to re-validate here — the callback
  // handler reads site credentials from KV state stored during authorize.
  const callbackMatch = path.match(/^\/callback\/([^/]+)$/);
  if (callbackMatch) {
    return handleCallback(request, env);
  }

  // Also handle /callback without siteId (fallback for clients that don't
  // include it).
  if (path === "/callback") {
    return handleCallback(request, env);
  }

  if (path === "/logout-callback") {
    return handleLogoutCallback(request, env);
  }

  if (path === "/info" && env.ENABLE_INFO_ENDPOINT === "true") {
    return renderInfoResponse(options, env);
  }

  return new Response("Not Found", { status: 404 });
}

function renderProtectedResourceMetadata(
  request: Request,
  url: URL,
  resourcePath: string,
): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  const issuer = `${url.protocol}//${url.host}`;
  const tenantUrl = `${issuer}${resourcePath}`;
  return new Response(
    JSON.stringify({
      resource: tenantUrl,
      // Tenant-pinned per issue #100 — clients walk per-tenant AS metadata
      // and never lose the alias.
      authorization_servers: [tenantUrl],
      bearer_methods_supported: ["header"],
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

// ============================================================================
// Authorize / Callback Handlers
// ============================================================================

async function handleAuthorize(
  request: Request,
  env: HostedMcpEnv,
  authOptions: UmbracoAuthHandlerOptions,
): Promise<Response> {
  try {
    const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const authorizeHandler = createAuthorizeHandler(env, authOptions);
    return authorizeHandler(request, authRequest);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authorization request failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleLogoutCallback(
  request: Request,
  env: HostedMcpEnv,
): Promise<Response> {
  const handler = createLogoutCallbackHandler(env);
  return handler(request);
}

async function handleCallback(
  request: Request,
  env: HostedMcpEnv,
): Promise<Response> {
  try {
    const callbackHandler = createCallbackHandler(env);
    const result = await callbackHandler(request);

    // Complete the MCP OAuth flow: issue an authorization code
    // for the MCP client and redirect back to it.
    // Consent choices (including siteId) are already in result.props
    // from KV state — no need to inject them here.
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: result.authRequest,
      userId: result.props.userId,
      metadata: { userName: result.props.userName },
      scope: result.authRequest.scope,
      props: result.props,
    });

    return Response.redirect(redirectTo, 302);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// Landing Pages
// ============================================================================

function renderLandingPageResponse(
  name: string,
  version: string,
  umbracoUrl: string
): Response {
  return new Response(
    renderLandingPage(name, version, umbracoUrl),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
      },
    }
  );
}

function renderMultiSiteLandingResponse(
  name: string,
  version: string,
  multiSite: MultiSiteConfig
): Response {
  return new Response(
    renderMultiSiteLandingPage(name, version, multiSite),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
      },
    }
  );
}

function renderSiteRoutingLandingResponse(
  name: string,
  version: string,
  pathPrefix: string
): Response {
  return new Response(
    renderSiteRoutingLandingPage(name, version, pathPrefix),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
      },
    }
  );
}

function renderLandingPage(
  name: string,
  version: string,
  umbracoUrl: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)} - Hosted MCP Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; margin: 0;
    }
    .card {
      background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      max-width: 480px; width: 100%; padding: 2rem; text-align: center;
    }
    h1 { color: #1b264f; font-size: 1.5rem; margin-bottom: 0.5rem; }
    .version { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .info { text-align: left; font-size: 0.9rem; color: #444; }
    .info dt { font-weight: 600; margin-top: 0.75rem; }
    .info dd { margin-left: 0; color: #666; }
    code { background: #f0f0f0; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(name)}</h1>
    <div class="version">v${escapeHtml(version)}</div>
    <dl class="info">
      <dt>MCP Endpoint</dt>
      <dd><code>/</code></dd>
      <dt>Umbraco Instance</dt>
      <dd><code>${escapeHtml(umbracoUrl)}</code></dd>
      <dt>Transport</dt>
      <dd>Streamable HTTP (MCP 2025-03-26)</dd>
    </dl>
  </div>
</body>
</html>`;
}

function renderMultiSiteLandingPage(
  name: string,
  version: string,
  multiSite: MultiSiteConfig
): string {
  const siteRows = multiSite.sites
    .map(
      (site) => `
      <tr>
        <td><strong>${escapeHtml(site.displayName)}</strong></td>
        <td><code>${escapeHtml(site.baseUrl)}</code></td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)} - Hosted MCP Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; margin: 0;
    }
    .card {
      background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      max-width: 600px; width: 100%; padding: 2rem; text-align: center;
    }
    h1 { color: #1b264f; font-size: 1.5rem; margin-bottom: 0.5rem; }
    .version { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .info { text-align: left; font-size: 0.9rem; color: #444; margin-bottom: 1rem; }
    .info dt { font-weight: 600; margin-top: 0.75rem; }
    .info dd { margin-left: 0; color: #666; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; }
    th { color: #666; font-size: 0.75rem; text-transform: uppercase; padding: 0.5rem 0.75rem; border-bottom: 2px solid #eee; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f0f0f0; color: #444; }
    code { background: #f0f0f0; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.85rem; }
    .transport { margin-top: 1rem; font-size: 0.8rem; color: #888; }
    .note { margin-top: 0.75rem; font-size: 0.8rem; color: #888; font-style: italic; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(name)}</h1>
    <div class="version">v${escapeHtml(version)}</div>
    <dl class="info">
      <dt>MCP Endpoint</dt>
      <dd><code>/</code></dd>
    </dl>
    <table>
      <thead>
        <tr>
          <th>Site</th>
          <th>Umbraco Instance</th>
        </tr>
      </thead>
      <tbody>${siteRows}
      </tbody>
    </table>
    <div class="note">Site selection happens during authorization.</div>
    <div class="transport">Streamable HTTP (MCP 2025-03-26)</div>
  </div>
</body>
</html>`;
}

function renderSiteRoutingLandingPage(
  name: string,
  version: string,
  pathPrefix: string
): string {
  // Render `:siteId` in the path as italic so it's clear it's a placeholder.
  const exampleEndpoint = pathPrefix
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/, (m) => `<em>{${m.slice(1)}}</em>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)} - Hosted MCP Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; margin: 0;
    }
    .card {
      background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      max-width: 560px; width: 100%; padding: 2rem; text-align: center;
    }
    h1 { color: #1b264f; font-size: 1.5rem; margin-bottom: 0.5rem; }
    .version { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .info { text-align: left; font-size: 0.9rem; color: #444; }
    .info dt { font-weight: 600; margin-top: 0.75rem; }
    .info dd { margin-left: 0; color: #666; }
    code { background: #f0f0f0; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.85rem; }
    em { color: #888; font-style: italic; }
    .note { margin-top: 0.75rem; font-size: 0.8rem; color: #888; font-style: italic; }
    .transport { margin-top: 1rem; font-size: 0.8rem; color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(name)}</h1>
    <div class="version">v${escapeHtml(version)}</div>
    <dl class="info">
      <dt>MCP Endpoint</dt>
      <dd><code>${exampleEndpoint}/</code></dd>
      <dt>Per-project URLs</dt>
      <dd>Each Umbraco project has its own MCP endpoint; the project alias is encoded in the URL path.</dd>
    </dl>
    <div class="note">Connect your MCP client to the endpoint for the specific project you want to access.</div>
    <div class="transport">Streamable HTTP (MCP 2025-03-26)</div>
  </div>
</body>
</html>`;
}

// ============================================================================
// Info Endpoint
// ============================================================================

function renderInfoResponse(
  options: HostedMcpServerOptions,
  env: HostedMcpEnv,
): Response {
  const workerConfig = loadWorkerConfig(env);
  const info: Record<string, unknown> = {
    name: options.name,
    version: options.version,
    transport: "streamable-http",
    mcpEndpoint: "/",
    collections: options.collections.map((c) => ({
      name: c.metadata.name,
      displayName: c.metadata.displayName,
      toolCount: c.tools(undefined).length,
    })),
    modes: [...options.allModeNames],
    slices: [...options.allSliceNames].filter((s) => s !== "other"),
    config: workerConfig,
  };

  if (options.chainedServers && options.chainedServers.length > 0) {
    info.chainedServers = options.chainedServers.map((cs) => ({
      name: cs.name,
      displayName: cs.displayName,
      collections: cs.collections.map((c) => ({
        name: c.metadata.name,
        displayName: c.metadata.displayName,
        toolCount: c.tools(undefined).length,
      })),
      modes: [...cs.allModeNames],
    }));
  }

  return Response.json(info);
}

function renderMultiSiteInfoResponse(
  options: HostedMcpServerOptions,
  env: HostedMcpEnv,
  multiSite: MultiSiteConfig,
): Response {
  const workerConfig = loadWorkerConfig(env);
  const info: Record<string, unknown> = {
    name: options.name,
    version: options.version,
    transport: "streamable-http",
    mcpEndpoint: "/",
    collections: options.collections.map((c) => ({
      name: c.metadata.name,
      displayName: c.metadata.displayName,
      toolCount: c.tools(undefined).length,
    })),
    modes: [...options.allModeNames],
    slices: [...options.allSliceNames].filter((s) => s !== "other"),
    config: workerConfig,
    sites: multiSite.sites.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      baseUrl: s.baseUrl,
    })),
  };

  if (options.chainedServers && options.chainedServers.length > 0) {
    info.chainedServers = options.chainedServers.map((cs) => ({
      name: cs.name,
      displayName: cs.displayName,
      collections: cs.collections.map((c) => ({
        name: c.metadata.name,
        displayName: c.metadata.displayName,
        toolCount: c.tools(undefined).length,
      })),
      modes: [...cs.allModeNames],
    }));
  }

  return Response.json(info);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Re-export AuthProps for use in McpAgent type parameters
export type { AuthProps };
