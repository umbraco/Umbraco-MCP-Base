/**
 * Per-Request McpServer Factory
 *
 * Creates a fresh McpServer instance per request to prevent response data
 * leakage between clients (required by MCP SDK 1.26.0+).
 *
 * Reuses SDK components for tool filtering, annotations, and decorators.
 */

import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createCloudflareTracingAdapter,
  type CloudflareTracing,
} from "../telemetry/cloudflare-tracing.js";
import { SERVER_INIT_SPAN, HostedTelemetryAttributes } from "../telemetry/attributes.js";
import { sanitizeForLog } from "../util/log-sanitize.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js";
import { z } from "zod";
import {
  shouldIncludeTool,
  createToolAnnotations,
  createCollectionConfigLoader,
  expandModesToCollections,
  checkUmbracoVersion,
  VersionCheckService,
  registerToolCollection,
  setTelemetryAdapter,
  getTelemetryAdapter,
  prepareRequestTelemetryContext,
  withRequestTelemetryContext,
  runWithRequestContext,
  getActiveRequestContext,
  pickCarriedRequestContext,
  isRequestContextStoreAvailable,
  requireRequestContext,
  toolCallExtraIndex,
  TelemetryAttributes,
  SERVER_INFORMATION_PATH,
  useDraft202012ToolSchemas,
  type TelemetrySpan,
  type ToolCollectionExport,
  type ToolModeDefinition,
  type CollectionConfiguration,
  type ServerConfigForCollections,
  type RequestTelemetryContext,
  withRequestUmbracoVersion,
  UMBRACO_VERSION_CONTEXT_KEY,
  type RequestSessionContext,
  type CarriedRequestContext,
  type RequestTransport,
} from "@umbraco-cms/mcp-server-sdk";
import { resolveRequestTelemetry } from "../telemetry/request-telemetry.js";
import type { HostedMcpEnv } from "../types/env.js";
import type { MultiSiteConfig, SiteConfig } from "../types/multi-site.js";
import { loadWorkerConfig, loadSiteConfig } from "../config/worker-config.js";
import { createFetchClientFromKV } from "../http/umbraco-fetch-client.js";
import type { AuthProps, ConsentChoices } from "../types/auth.js";
import type { RefreshFailureReason } from "../auth/token-storage.js";

/**
 * Fetches the current user from Umbraco's Management API.
 * Used to provide per-user tool filtering based on allowed sections.
 */
async function fetchCurrentUser(
  fetchClient: Awaited<ReturnType<typeof createFetchClientFromKV>> & {}
): Promise<Record<string, unknown>> {
  let user: Record<string, unknown> = {};
  try {
    const fetched = await fetchClient({
      url: "/umbraco/management/api/v1/user/current",
      method: "GET",
    });
    user = (fetched ?? {}) as Record<string, unknown>;
  } catch {
    // If we can't fetch the user, fall through to defaults. Tools that
    // gate on permissions will see empty arrays and refuse to expose
    // themselves; the auth-expired surface handles the bad-token case.
  }
  // Guarantee the array-shaped fields downstream policy predicates iterate
  // over. Without this, every consumer has to guard with `?? []` against the
  // empty-object fallback above (and against partial responses).
  if (!Array.isArray(user.allowedSections)) user.allowedSections = [];
  if (!Array.isArray(user.userGroupIds)) user.userGroupIds = [];
  return user;
}

/**
 * Callback to dynamically resolve a SiteConfig from a site identifier.
 * Used for URL-based site routing where sites are not statically enumerated.
 * Return null to reject unknown sites.
 */
export type SiteResolver = (
  siteId: string,
  env: HostedMcpEnv
) => SiteConfig | null | Promise<SiteConfig | null>;

/**
 * Resolves to a server-level `instructions` string that the MCP server sends
 * to clients during the `initialize` handshake. Most clients fold this into
 * the model's system prompt, so it applies implicitly without per-tool repetition.
 *
 * Pass a string for a constant instruction, or a callback to compute one
 * per-request — useful for multi-site deployments where each site wants its
 * own editorial guidance, or for personalising guidance based on the user.
 */
export type InstructionsResolver =
  | string
  | ((props: AuthProps, env: HostedMcpEnv) => string | Promise<string>);

/**
 * Options for creating a per-request McpServer.
 */
export interface CreateServerOptions {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** Tool collections to register */
  collections: ToolCollectionExport[];
  /** Mode registry for tool filtering */
  modeRegistry: ToolModeDefinition[];
  /** All valid mode names */
  allModeNames: readonly string[];
  /** All valid slice names */
  allSliceNames: readonly string[];
  /**
   * Optional server-level instructions sent to clients on `initialize`.
   * Pass a string, or a callback that receives the per-request `AuthProps`
   * and `env` (e.g. for site- or user-specific guidance).
   */
  instructions?: InstructionsResolver;
  /**
   * Factory for the API client used by tool handlers. Required in practice:
   * a hosted server without one fails with "API client not configured" the
   * first time a handler calls `getApiClient()` / `executeGetApiCall`.
   *
   * Tool handlers call `executeGetApiCall((client) => client.someMethod(...))`.
   * The `client` is whatever this factory returns: it is put in the SDK's
   * per-request store as this session's `apiClientProvider` around every tool
   * call (never via the module-level `configureApiClient`, which every session
   * in the isolate shares, so hosted code must not call it).
   *
   * The session's fetch client is also put in the same store as the
   * `transport` behind `UmbracoManagementClient`, so the Orval client's named
   * methods (e.g. `client.getTreeDataTypeRoot()`) go out with this session's
   * site URL and token. A typical factory just returns the Orval client.
   */
  clientFactory?: () => unknown;
  /** Multi-site deployment configuration (for resolving site-specific URLs and filters) */
  multiSite?: MultiSiteConfig;
  /**
   * The Umbraco major version this server's tools target (e.g. "17") — the
   * hosted-worker counterpart of the stdio entry point's `expectedUmbracoMajor`
   * (see the SDK's `checkUmbracoVersion`). Pass the generated
   * `UMBRACO_TARGET_MAJOR` constant here; `env.UMBRACO_EXPECTED_MAJOR` overrides
   * it per-deployment at request time, matching the stdio override precedence.
   *
   * When set, `createPerRequestServer` checks the connected Umbraco's version
   * on every request and folds a mismatch warning into that request's
   * `instructions`. Omit to skip the check entirely.
   */
  expectedUmbracoMajor?: string;
  /**
   * Dynamic site resolver. Alternative to `multiSite` for URL-based site routing
   * where sites are resolved dynamically (e.g., from a database or URL pattern)
   * rather than from a static list.
   *
   * When both `multiSite` and `resolveSite` are provided, `resolveSite` takes precedence.
   */
  resolveSite?: SiteResolver;
  /**
   * Opt into OpenTelemetry tracing for tool calls.
   *
   * Pass the `tracing` object from `cloudflare:workers` — this package can't
   * import it directly (the specifier only resolves inside the Workers runtime),
   * the same reason `McpAgent` and `OAuthProvider` come from the consumer:
   *
   * ```ts
   * import { tracing } from "cloudflare:workers";
   * // ...
   * telemetry: { tracing }
   * ```
   *
   * Omit it and tool calls run through the SDK's pass-through adapter, recording
   * nothing. Spans only leave the Worker once `[observability.traces]` in the
   * Wrangler config names an OTLP destination, so wiring this up is safe well
   * before any exporter exists.
   */
  telemetry?: {
    /** The `tracing` object from `cloudflare:workers`. */
    tracing: CloudflareTracing;
  };
}

/**
 * Merges user consent choices into the env-level config.
 *
 * Consent choices can only **narrow** the admin config, never expand it.
 * - If admin restricts modes to [content, media] and user selects [content],
 *   result is [content].
 * - If admin has no mode restriction and user selects [content],
 *   result is [content].
 * - readOnly can only be turned ON by the user, never turned OFF
 *   (if admin already set readOnly via excludeSlices, user can't undo it).
 */
export function mergeConsentChoices(
  envConfig: ServerConfigForCollections,
  choices?: ConsentChoices,
  modeRegistry?: ToolModeDefinition[]
): ServerConfigForCollections {
  if (!choices) return envConfig;

  const merged = { ...envConfig };

  // Merge selected modes: intersect with admin config if admin has restrictions
  if (choices.selectedModes && choices.selectedModes.length > 0) {
    if (merged.toolModes && merged.toolModes.length > 0) {
      // Intersect: only keep modes that are in BOTH admin config and user selection
      merged.toolModes = merged.toolModes.filter((m) =>
        choices.selectedModes!.includes(m)
      );
    } else {
      // Admin has no mode restriction — user selection becomes the restriction
      merged.toolModes = [...choices.selectedModes];
    }
  } else if (
    choices.chainedModeSelections &&
    Object.keys(choices.chainedModeSelections).length > 0 &&
    (!choices.selectedModes || choices.selectedModes.length === 0)
  ) {
    // User selected chained server modes but no main modes — disable all main tools.
    // Use a sentinel mode that won't match any real mode to ensure no main tools appear.
    merged.toolModes = ["__none__"];
  }

  // Merge selected collections: exclude deselected collections within the effective modes
  if (choices.selectedCollections?.length && modeRegistry) {
    const effectiveModes = merged.toolModes ?? [];
    const available = effectiveModes.length > 0
      ? expandModesToCollections(effectiveModes, modeRegistry)
      : modeRegistry.flatMap((m) => m.collections);

    const deselected = available.filter(
      (c) => !choices.selectedCollections!.includes(c)
    );
    if (deselected.length > 0) {
      const existing = merged.excludeToolCollections ?? [];
      merged.excludeToolCollections = [
        ...existing,
        ...deselected.filter((c) => !existing.includes(c)),
      ];
    }
  }

  // Merge selected slices: intersect with admin config if admin has restrictions
  if (choices.selectedSlices?.length) {
    if (merged.includeSlices?.length) {
      // Intersect: only keep slices in BOTH admin config and user selection
      merged.includeSlices = merged.includeSlices.filter((s) =>
        choices.selectedSlices!.includes(s)
      );
    } else {
      // Admin has no slice restriction — user selection becomes the restriction
      merged.includeSlices = [...choices.selectedSlices];
    }
  }

  // Merge read-only: user can turn it ON but not OFF
  if (choices.readOnly) {
    merged.readonly = true;
  }

  return merged;
}

/**
 * Resolves a site config from either a dynamic resolver or a static site list.
 * The dynamic resolver (`resolveSite`) takes precedence over the static list (`multiSite`).
 *
 * @returns The resolved SiteConfig, or null/undefined if no site found
 */
export async function resolveRequestSite(
  siteId: string | undefined,
  options: Pick<CreateServerOptions, "resolveSite" | "multiSite">,
  env: HostedMcpEnv
): Promise<SiteConfig | null | undefined> {
  if (!siteId) return undefined;

  if (options.resolveSite) {
    return options.resolveSite(siteId, env);
  }

  return options.multiSite?.sites.find((s) => s.id === siteId);
}

/**
 * Servers built by `createAuthExpiredServer`, so `isAuthExpiredServer` can
 * tell them apart from a normal, fully-registered server without adding a
 * discriminated return type to `createPerRequestServer` (a breaking change
 * for every existing caller). A `WeakSet` rather than a property on the
 * server instance: nothing about the degraded server's own shape needs to
 * change for callers to detect it.
 */
const authExpiredServers = new WeakSet<McpServer>();

/**
 * Whether `server` is the degraded, single-tool server `createPerRequestServer`
 * returns when there's no usable Umbraco session (see `createAuthExpiredServer`).
 *
 * Callers that register additional tools on the server returned by
 * `createPerRequestServer` — `registerChainedTools` is the one in this
 * package — MUST check this and skip when it's true. Without it, a chained
 * toolset gets bolted onto the degraded server on top of its single
 * `authentication-expired` tool, silently defeating the point of degrading:
 * the model sees a full set of tools that all 401 instead of the one tool
 * that says why.
 */
export function isAuthExpiredServer(server: McpServer): boolean {
  return authExpiredServers.has(server);
}

/**
 * Builds the degraded, single-tool server used when this session has no usable
 * Umbraco credentials — either KV has no token entry at all, or the stored
 * refresh token has been definitively rejected by Umbraco.
 *
 * One tool, whose only job is to tell the client to reconnect. Returning the
 * full toolset instead would give the model a hundred tools that each 401.
 */
function createAuthExpiredServer(
  options: Pick<CreateServerOptions, "name" | "version">,
  instructions: string | undefined,
  detail: string
): McpServer {
  const server = new McpServer(
    { name: options.name, version: options.version },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions,
    },
  );
  server.registerTool(
    "authentication-expired",
    {
      description: "Your Umbraco session has expired. Disconnect and reconnect this MCP server to re-authenticate.",
      inputSchema: z.object({}),
      annotations: {
        title: "Authentication Expired",
        readOnlyHint: true,
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: detail,
        },
      ],
      isError: true,
    })
  );
  useDraft202012ToolSchemas(server);
  authExpiredServers.add(server);
  return server;
}

/** The message the degraded server's single tool returns. */
const AUTH_EXPIRED_MESSAGE =
  "Your Umbraco authentication has expired or been invalidated. Please disconnect and reconnect this MCP server to trigger a fresh login.";

/**
 * Same, but for the case where we know *why*: Umbraco rejected the stored
 * refresh token outright. Worth saying, because the cause is a configurable
 * Umbraco setting rather than anything the user did.
 */
const REFRESH_EXPIRED_MESSAGE =
  "Your Umbraco session has expired: the stored refresh token was rejected by Umbraco (invalid_grant). " +
  "Umbraco derives both token lifetimes from `Umbraco:CMS:Global:TimeOut` (20 minutes by default), so a " +
  "session left idle for longer than that has to be re-authenticated. Please disconnect and reconnect " +
  "this MCP server to trigger a fresh login.";

/**
 * Same degraded server again, but for a refresh Umbraco rejected because of the
 * *client*, not the token. Deliberately does NOT tell the user to reconnect: a
 * fresh login replays the same broken client registration, so the advice would
 * send them round a loop that cannot succeed. This one needs an administrator.
 */
const REFRESH_MISCONFIGURED_MESSAGE =
  "Umbraco rejected this MCP server's OAuth client (invalid client_id/secret, or a grant type the client " +
  "is not allowed to use). Reconnecting will not fix this — it replays the same client credentials. An " +
  "administrator needs to correct the Umbraco-side client registration for this MCP server: its client id, " +
  "its client secret, and the grant types it is permitted to use.";

/**
 * Same again, but Umbraco rejected the refresh *request* itself
 * (`invalid_request` / `invalid_scope`) rather than the token or the client's
 * credentials. Also does NOT suggest reconnecting: `refreshUmbracoToken`
 * always posts the same fixed param set, so if this instance's OAuth client
 * registration no longer grants a scope this request needs, every future
 * refresh — including the one a fresh login would immediately need — fails
 * identically. Degrading rather than silently keeping the full toolset means
 * a persistent version of this surfaces instead of 401ing forever with no
 * explanation.
 */
const REFRESH_REQUEST_REJECTED_MESSAGE =
  "Umbraco rejected the token refresh request itself (invalid_request or invalid_scope), not the stored " +
  "refresh token or this MCP server's client credentials. Reconnecting is unlikely to help, since the same " +
  "request would be rejected the same way. An administrator should check whether this Umbraco instance's " +
  "OAuth client registration still grants the scope this server requests, and whether anything between " +
  "this Worker and Umbraco (a proxy or gateway) could be altering the refresh request.";

/**
 * Which `RefreshFailureReason`s degrade the session, and what to tell the
 * client when they do — `null` for the two left non-degrading (`network`,
 * `server_error`: a blip must not strip a working session). A `Record` over
 * every `RefreshFailureReason` (not `Partial`) rather than a chain of `? :`
 * so adding a new reason is a compile error here until it's given an explicit
 * entry — `Partial` would let a forgotten reason silently resolve to
 * `undefined` (i.e. "don't degrade") with nothing at compile time to catch it,
 * which defeats the point of keying by the reason type at all.
 */
const DEGRADED_REFRESH_REASONS: Record<
  RefreshFailureReason,
  { message: string; cause: string } | null
> = {
  expired: { message: REFRESH_EXPIRED_MESSAGE, cause: "refresh-rejected-expired" },
  misconfigured: { message: REFRESH_MISCONFIGURED_MESSAGE, cause: "refresh-rejected-misconfigured" },
  request_rejected: { message: REFRESH_REQUEST_REJECTED_MESSAGE, cause: "refresh-rejected-request" },
  server_error: null,
  network: null,
};

/**
 * Creates a per-request McpServer with tools registered and API client configured.
 *
 * This factory is called for each incoming MCP request to ensure:
 * - No response data leakage between clients
 * - API client is configured with the correct user's Umbraco token
 * - Tool filtering is applied from Worker env config + user consent choices
 *
 * @param options - Server configuration (constant across requests)
 * @param env - Cloudflare Worker environment bindings
 * @param props - Auth props from the OAuthProvider (per-request, user-specific)
 * @param sessionId - Optional MCP session id (from `McpAgent.getSessionId()`),
 *   recorded as `mcp.session.id` on the init span so a degraded start can be
 *   tied back to the session that hit it
 * @returns Configured McpServer ready to handle the request
 */
export async function createPerRequestServer(
  options: CreateServerOptions,
  env: HostedMcpEnv,
  props: AuthProps,
  sessionId?: string
): Promise<McpServer> {
  // Install the tracing adapter first: it has to be in place before the init
  // span below is opened, let alone before any tool can run. Only static facts
  // go on it — see `createCloudflareTracingAdapter` for why request-scoped
  // values (tenant, client, site) must not be closed over in a module-scoped
  // adapter. Re-registering on every DO start is harmless: the values are
  // identical for every request this Worker serves.
  if (options.telemetry?.tracing) {
    const staticAttributes: Record<string, string> = {
      [TelemetryAttributes.SERVER_NAME]: options.name,
      [TelemetryAttributes.SERVER_VERSION]: options.version,
    };
    const expectedMajor = env.UMBRACO_EXPECTED_MAJOR ?? options.expectedUmbracoMajor;
    if (expectedMajor) {
      staticAttributes[TelemetryAttributes.UMBRACO_MAJOR] = expectedMajor;
    }

    setTelemetryAdapter(
      createCloudflareTracingAdapter({
        tracing: options.telemetry.tracing,
        attributes: staticAttributes,
      })
    );
  }

  // The span duration is the answer to "cold start or hibernation wake?" — the
  // question the log lines below were added for (Umbraco-MCP-Base#132). Those
  // logs stay: the trace id can't be read at runtime (Cloudflare's span exposes
  // no `spanContext()`), so deleting the hand-rolled correlation id would leave
  // `wrangler tail` with nothing to tie `:start` to `:done`.
  return getTelemetryAdapter().startSpan(SERVER_INIT_SPAN, {}, (span) =>
    initPerRequestServer(options, env, props, span, sessionId)
  );
}

/**
 * Stamps the request-scoped identity attributes on the init span — the MCP
 * session id plus the already-hashed tenant/login-session and plaintext region
 * from `resolveRequestTelemetry`. Done before any early return, so a degraded
 * start is attributable to a session and tenant just like a full one. Absent
 * values stay absent, matching `resolveRequestTelemetry`'s own rule.
 */
function stampInitIdentity(
  initSpan: TelemetrySpan,
  sessionId: string | undefined,
  telemetry: RequestTelemetryContext
): void {
  if (sessionId) initSpan.setAttribute(TelemetryAttributes.MCP_SESSION_ID, sessionId);
  if (telemetry.tenant) initSpan.setAttribute(TelemetryAttributes.TENANT, telemetry.tenant);
  if (telemetry.region) initSpan.setAttribute(TelemetryAttributes.REGION, telemetry.region);
  if (telemetry.loginSession) {
    initSpan.setAttribute(TelemetryAttributes.LOGIN_SESSION, telemetry.loginSession);
  }
}

/**
 * The body of `createPerRequestServer`, split out so the whole initialisation
 * sits inside one span. `initSpan` collects the outcome attributes at each exit.
 */
async function initPerRequestServer(
  options: CreateServerOptions,
  env: HostedMcpEnv,
  props: AuthProps,
  initSpan: TelemetrySpan,
  sessionId?: string
): Promise<McpServer> {
  // Per-session values live only in the request store; without it a handler
  // would read module slots that another session may own.
  if (!isRequestContextStoreAvailable()) {
    throw new Error(
      "mcp-hosted requires AsyncLocalStorage (nodejs_compat_v2 on Cloudflare Workers) to keep per-session state separate."
    );
  }
  requireRequestContext();

  // Trace logging so `wrangler tail` makes wake-vs-cold visible. The
  // agents-mcp runtime is supposed to run `init()` (and therefore this
  // function) on every Durable Object start, but it's easy to lose track
  // of when that actually happens — particularly across hibernation wakes.
  // See umbraco/Umbraco-MCP-Base#132 for the failure mode this guards against.
  //
  // `siteId` may come from a user-submitted consent form in static
  // multi-site mode; strip control characters before logging so it can't
  // forge log lines on `wrangler tail`.
  const initStartedAt = Date.now();
  const traceId = Math.random().toString(36).slice(2, 8);
  const safeSiteId = sanitizeForLog(props.consentChoices?.siteId);
  console.log(
    `[mcp-hosted] createPerRequestServer:start id=${traceId} server=${options.name}@${options.version} siteId=${safeSiteId}`
  );

  // Request-scoped span enrichment: which tenant, which region, which login.
  // Resolved here — the only layer that holds both `props` and `env` — and
  // before either degraded early return below, so a `degraded-auth-expired`
  // start carries the same session/tenant identity as a full one. Never
  // throws (see `resolveRequestTelemetry`).
  const rawRequestTelemetry = await resolveRequestTelemetry(props, env);
  stampInitIdentity(initSpan, sessionId, rawRequestTelemetry);

  const baseInstructions =
    typeof options.instructions === "function"
      ? await options.instructions(props, env)
      : options.instructions;

  // Resolve site-specific env overlay for multi-site deployments.
  // Uses the site's base URL for API calls instead of the global env URL.
  let effectiveEnv = env;
  const siteId = props.consentChoices?.siteId;
  const site = await resolveRequestSite(siteId, options, env);

  if (site) {
    effectiveEnv = {
      ...env,
      UMBRACO_BASE_URL: site.baseUrl,
      UMBRACO_SERVER_URL: site.serverUrl,
    };
  }

  // Create fetch-based API client with this user's stored Umbraco token.
  // Uses site-specific base URL when in multi-site mode.
  const fetchClient = await createFetchClientFromKV(effectiveEnv, props.umbracoTokenKey);
  if (!fetchClient) {
    // Token is gone from KV (e.g. wrangler restart, KV expiry, or Umbraco restart
    // invalidated it). Return a degraded server with a single tool that tells the
    // client to disconnect and reconnect to trigger a fresh OAuth flow.
    // No credentials means no version check either — there's nothing to call.
    const server = createAuthExpiredServer(options, baseInstructions, AUTH_EXPIRED_MESSAGE);
    console.log(
      `[mcp-hosted] createPerRequestServer:done id=${traceId} mode=degraded-auth-expired cause=no-token-in-kv tools=1 elapsedMs=${Date.now() - initStartedAt}`
    );
    initSpan.setAttribute(HostedTelemetryAttributes.INIT_MODE, "degraded-auth-expired");
    initSpan.setAttribute(HostedTelemetryAttributes.INIT_TOOL_COUNT, 1);
    return server;
  }

  // Re-bind to a non-nullable const: TS narrowing from the guard above isn't
  // preserved for the outer `fetchClient` once it's referenced inside the
  // nested `checkVersion` closure below.
  const client = fetchClient;

  // Version check — connected Umbraco major vs. what this server's tools target.
  //
  // Deliberately uses a request-scoped `VersionCheckService` instance, never
  // the SDK's `versionCheckService` singleton (and never
  // `configureVersionCheckHook()`, which wires that singleton into a
  // *module-level* pre-execution hook shared by every decorated tool handler
  // in this Worker isolate). The stdio entry point can rely on the singleton
  // because one process only ever talks to one Umbraco instance. A Worker
  // isolate is not so simple: concurrent requests here can belong to
  // different users, and under `siteRouting`/`multiSite` to entirely
  // different Umbraco instances. Wiring the global hook would let one
  // request's mismatch state block (or silently pass) another request's
  // tool calls. Folding the message into this request's own `instructions`
  // gives the same "the model/user sees the warning" outcome without that
  // cross-request leakage — see umbraco/Umbraco-MCP-Base#224.
  const expectedUmbracoMajor = env.UMBRACO_EXPECTED_MAJOR ?? options.expectedUmbracoMajor;

  // One `/server/information` request per server creation, shared by the
  // version check and the version capture below, so the site is never asked
  // twice. Memoised here, in this function's scope — never at module level,
  // which every session (and site) in the isolate shares.
  let serverInformationRequest: Promise<{ version: string }> | undefined;
  function requestServerInformation(): Promise<{ version: string }> {
    serverInformationRequest ??= client({
      url: SERVER_INFORMATION_PATH,
      method: "GET",
    }).then((info) => ({ version: (info as { version: string }).version }));
    return serverInformationRequest;
  }

  // The connected site's raw version (e.g. `17.1.0-rc.2+abc`) for
  // `collection.tools` and the per-request store; parsing is the SDK's job.
  // Never fails server creation: a 401, 5xx or network error resolves to
  // `undefined`, which the SDK treats as "oldest".
  async function fetchServerInformation(): Promise<{ version: string } | undefined> {
    try {
      const info = await requestServerInformation();
      return typeof info.version === "string" && info.version.length > 0 ? info : undefined;
    } catch {
      return undefined;
    }
  }

  async function checkVersion(): Promise<string | null> {
    const versionCheckService = new VersionCheckService();
    await checkUmbracoVersion({
      mcpVersion: options.version,
      expectedUmbracoMajor: expectedUmbracoMajor!,
      client: {
        // The shared request, not `fetchServerInformation`: the check needs the
        // rejection itself so its "Unable to verify" warning keeps the reason.
        getServerInformation: requestServerInformation,
      },
      service: versionCheckService,
    });
    return versionCheckService.getMessage();
  }

  // Run the version check and the server-info fetch alongside the
  // current-user fetch below — all independent reads through the same fetch
  // client, so there's no reason to serialize the round-trips this function
  // makes per request. The server-info fetch always runs; the check only when
  // `expectedUmbracoMajor` is set.
  const [versionCheckMessage, currentUser, serverInformation] = await Promise.all([
    expectedUmbracoMajor ? checkVersion() : Promise.resolve(null),
    fetchCurrentUser(fetchClient),
    fetchServerInformation(),
  ]);
  const umbracoVersion = serverInformation?.version;

  // Those round-trips are also this request's liveness probe. If any hit
  // a 401 and the refresh came back with a definitive `invalid_grant`, KV still
  // holds an entry (so the guard above passed) but the session is over — hand
  // back the same degraded server rather than a toolset that 401s on every call.
  //
  // Gated on the two *definitive* reasons: `expired` (Umbraco will never accept
  // this refresh token again) and `misconfigured` (Umbraco rejected the client
  // itself — a bad client_id/secret or grant configuration, which no number of
  // retries will heal). A network blip or a 5xx from the token endpoint must
  // not strip a session's tools, because the very next request may well refresh
  // cleanly, so those two keep the full toolset.
  //
  // `getRefreshFailure()` only ever reports something after the fetch client
  // has actually made a request — `fetchCurrentUser` above is what does that
  // here (the server-info fetch does too, but it is an implementation detail
  // of version capture and shouldn't be relied on alone). If a future change
  // removes or reorders `fetchCurrentUser` so nothing exercises `fetchClient`
  // before this point, this check would silently stop firing. Keep something
  // calling through `fetchClient` ahead of this line.
  const refreshFailure = fetchClient.getRefreshFailure();
  const degradedRefresh = refreshFailure ? DEGRADED_REFRESH_REASONS[refreshFailure.reason] : null;
  if (degradedRefresh) {
    const server = createAuthExpiredServer(options, baseInstructions, degradedRefresh.message);
    console.log(
      `[mcp-hosted] createPerRequestServer:done id=${traceId} mode=degraded-auth-expired cause=${degradedRefresh.cause} tools=1 elapsedMs=${Date.now() - initStartedAt}`
    );
    initSpan.setAttribute(HostedTelemetryAttributes.INIT_MODE, "degraded-auth-expired");
    initSpan.setAttribute(HostedTelemetryAttributes.INIT_TOOL_COUNT, 1);
    return server;
  }

  const instructions = [baseInstructions, versionCheckMessage]
    .filter((part): part is string => Boolean(part))
    .join("\n\n") || undefined;

  const server = new McpServer(
    { name: options.name, version: options.version },
    {
      // Use Workers-compatible JSON Schema validator instead of Ajv.
      // Ajv uses new Function() which is blocked in Cloudflare Workers.
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions,
    },
  );

  // This session's values for the SDK's per-request store, entered around
  // every tool call by `registerCollectionTools` (and `registerChainedTools`).
  // Deliberately NOT written to the SDK's module-level slots
  // (`setCustomTransport` / `configureApiClient`): module scope is shared by
  // every Durable Object — i.e. every MCP session — in the isolate, so those
  // would be last-session-wins. Hosted turns on `requireRequestContext()`, so
  // outside the store `getApiClient()`, `getServerRef()` and
  // `UmbracoManagementClient` throw "outside a request context" instead of
  // silently using another session's value. See umbraco/Umbraco-MCP-Base#383.
  //
  // The connected Umbraco version rides the same entry (and the handler's
  // `extra`, where `withTelemetry` stamps it on the span). It never goes on the
  // tracing adapter's static attributes above: that adapter is module-scoped,
  // so interleaved requests for different sites would see each other's
  // version. Left off entirely when the fetch failed.
  const session: HostedSessionContext = {
    transport: fetchClient as unknown as RequestTransport,
    server: server.server,
    umbracoAuth: () => fetchClient.getSessionAuth(),
    // Without a `clientFactory` the session still gets a provider, one that
    // fails loudly. Leaving it unset would make `getApiClient()` fall through
    // to the module provider, i.e. whatever `configureApiClient` last set for
    // every session in the isolate, which is what the rule above forbids.
    apiClientProvider: options.clientFactory ?? missingClientFactoryProvider,
    ...(umbracoVersion ? { [UMBRACO_VERSION_CONTEXT_KEY]: umbracoVersion } : {}),
  };
  sessionContexts.set(server, session);

  // Load tool filtering config from Worker env
  let workerConfig = loadWorkerConfig(env);

  // Apply site-specific filter overrides if multi-site
  if (site) {
    workerConfig = loadSiteConfig(site, workerConfig);
  }

  // Merge user consent choices (narrows admin/site config, never expands)
  const effectiveConfig = mergeConsentChoices(workerConfig, props.consentChoices, options.modeRegistry);

  const configLoader = createCollectionConfigLoader({
    modeRegistry: options.modeRegistry,
    allModeNames: options.allModeNames,
    allSliceNames: options.allSliceNames,
  });
  const filterConfig: CollectionConfiguration =
    configLoader.loadFromConfig(effectiveConfig);

  // The request-scoped telemetry resolved at the top of this function is
  // handed to tool registration so each handler carries *this* request's
  // values. Deliberately not folded into the tracing adapter's static
  // attributes: that adapter is module-scoped and shared by every Durable
  // Object in the isolate, so a tenant key placed there would leak across
  // sessions (see `createCloudflareTracingAdapter`).
  // Prepared (validated + frozen) once here rather than inside
  // `registerCollectionTools`'s per-tool loop — every tool in this request
  // wraps the same reference, so there's no reason to re-check emptiness or
  // re-freeze a copy once per tool.
  const requestTelemetry = prepareRequestTelemetryContext(rawRequestTelemetry);

  // Register tools from all collections (with filtering)
  const registeredCount = registerCollectionTools(
    server,
    options.collections,
    currentUser,
    filterConfig,
    requestTelemetry,
    session,
  );

  // Covers the common case (chaining disabled, or a consumer that
  // registers chained tools after this returns but at least one main
  // tool already exists here). If filtering leaves zero main tools,
  // this is a no-op — see registerChainedTools() for the other half of
  // this guarantee.
  useDraft202012ToolSchemas(server);

  console.log(
    `[mcp-hosted] createPerRequestServer:done id=${traceId} mode=full tools=${registeredCount} site=${site?.id ?? "<single>"} elapsedMs=${Date.now() - initStartedAt}`
  );
  initSpan.setAttribute(HostedTelemetryAttributes.INIT_MODE, "full");
  initSpan.setAttribute(HostedTelemetryAttributes.INIT_TOOL_COUNT, registeredCount);
  // Whether a site was resolved, not which one — the alias is a customer
  // identifier and the log line above is Worker-local, whereas spans are
  // exported to a third party.
  initSpan.setAttribute(HostedTelemetryAttributes.INIT_SITE_RESOLVED, site !== null);
  return server;
}

/**
 * Each full server's per-session store values, so `registerChainedTools` can
 * enter the same store around the proxied tools it adds to that server. A
 * `WeakMap` keyed by the per-request server: it dies with the session.
 */
const sessionContexts = new WeakMap<McpServer, HostedSessionContext>();

/**
 * A hosted session's per-request store values: the SDK's session values plus
 * the connected Umbraco's raw version, when `createPerRequestServer` could
 * fetch it. One object, so a tool call enters a single store entry holding both.
 */
export type HostedSessionContext = RequestSessionContext &
  Pick<CarriedRequestContext, typeof UMBRACO_VERSION_CONTEXT_KEY>;

/** The `apiClientProvider` of a session whose server was built without a `clientFactory`. */
function missingClientFactoryProvider(): never {
  throw new Error(
    "API client not configured: this hosted server was created without a `clientFactory`. " +
      "Hosted servers must pass `clientFactory` to `createPerRequestServer` (or `HostedMcpServerOptions`) " +
      "and must not call `configureApiClient()`, whose module scope is shared by every session in the isolate."
  );
}

/**
 * The per-session store values `createPerRequestServer` built for `server`,
 * or `undefined` for a server it didn't build (or a degraded one).
 */
export function getServerSessionContext(server: McpServer): HostedSessionContext | undefined {
  return sessionContexts.get(server);
}

/**
 * Runs `fn` inside the SDK's per-request store holding `server`'s session
 * values (transport, API client provider, server, Umbraco auth), next to any
 * carried values (telemetry, Umbraco version) already on the active store.
 *
 * `createPerRequestServer` and `registerChainedTools` already do this for the
 * tools they register. Use it for anything a worker registers directly on the
 * server (`server.registerTool`, resources, prompts): without it that handler
 * runs outside the store, where `getApiClient()` and `getServerRef()` throw and
 * `UmbracoManagementClient` has no session transport.
 *
 * ```typescript
 * server.registerResource("example", "example://x", {}, (uri) =>
 *   runInSessionContext(server, async () => {
 *     const client = getApiClient<MyClient>();
 *     // ...
 *   })
 * );
 * ```
 *
 * @param server - A server returned by `createPerRequestServer`
 * @param fn - The work to run in this session's store
 * @returns Whatever `fn` returns
 * @throws When `server` has no session context: not built by `createPerRequestServer`, or the degraded auth-expired server. Check `isAuthExpiredServer(server)` before wrapping.
 */
export function runInSessionContext<T>(server: McpServer, fn: () => T): T {
  const session = sessionContexts.get(server);
  if (!session) {
    throw new Error(
      "runInSessionContext: this server has no session context. Pass a server returned by createPerRequestServer."
    );
  }
  return runWithRequestContext(
    { ...pickCarriedRequestContext(getActiveRequestContext()), ...session },
    () => {
      assertStoreActive("runInSessionContext");
      return fn();
    }
  );
}

/** Fails hard when the store did not take, instead of running on module scope. */
function assertStoreActive(caller: string): void {
  if (getActiveRequestContext() === undefined) {
    throw new Error(`${caller}: no request context is active, so this session's state cannot be entered.`);
  }
}

/**
 * Wraps a registered tool callback so it runs inside the SDK's per-request
 * store, holding this session's values (`session`) next to whatever carried
 * values (telemetry, Umbraco version) are on the call's `extra`.
 *
 * Applied innermost — inside `withRequestTelemetryContext` — so the telemetry
 * that wrapper attaches to `extra` is on it by the time this reads it.
 *
 * When the session carries the connected Umbraco version, it is attached to
 * `extra` too (via the SDK's `withRequestUmbracoVersion`), so the handler's
 * `context` and the store hold the same value and `withTelemetry` stamps it.
 *
 * @param callback - The tool callback being registered
 * @param session - This session's store values; a no-op wrapper when absent
 * @returns A callback with the same signature
 */
export function withRequestSessionContext<Callback extends (...args: any[]) => any>(
  callback: Callback,
  session: HostedSessionContext | undefined
): Callback {
  if (!session) {
    return callback;
  }
  const enterSessionContext = function (this: unknown, ...params: any[]) {
    // `extra` is `(args, extra)` with an input schema, `(extra)` without.
    // Only its carried, namespaced keys are picked.
    const extra = params[toolCallExtraIndex(params)];
    return runWithRequestContext({ ...pickCarriedRequestContext(extra), ...session }, () => {
      assertStoreActive("tool call");
      return callback.apply(this, params);
    });
  } as Callback;
  // A no-op when the session has no version (the fetch failed).
  return withRequestUmbracoVersion(enterSessionContext, session[UMBRACO_VERSION_CONTEXT_KEY]);
}

/**
 * Iterates collections, filters per the resolved `filterConfig`, and registers
 * each surviving tool on the McpServer.
 *
 * `tool._meta` is forwarded verbatim to `tools/list` so host extensions like
 * OpenAI's `openai/fileParams` reach the client.
 *
 * `requestTelemetry`, when supplied, is attached to each registered handler so
 * the values reach `withTelemetry` on the tool call's own `context` argument.
 * The closure that carries them belongs to this one `McpServer` — i.e. to one
 * request — which is what keeps two sessions sharing an isolate from being
 * attributed to each other. Omit it and nothing extra is wrapped. Callers
 * should pass the result of `prepareRequestTelemetryContext` (already
 * validated and frozen) rather than a raw value — every tool in this loop
 * shares the same reference, so preparing it once here instead of once per
 * tool (inside `withRequestTelemetryContext`) is the whole point.
 *
 * `session`, when supplied, is this session's values for the SDK's
 * per-request store (transport, API client provider, server, Umbraco auth);
 * each handler runs inside that store (see `withRequestSessionContext`), so
 * `UmbracoManagementClient`, `getApiClient()`, `getServerRef()` and
 * `getSessionUmbracoAuth()` resolve to this session even when sessions in the
 * same isolate interleave. When it carries the connected Umbraco version, that
 * version is also on each handler's `extra`.
 *
 * The connected site's raw version is read from `session` and handed to each
 * `collection.tools(currentUser, { umbracoVersion })` so a collection can pick
 * version-gated tools. Absent (no session, or the fetch failed) means "oldest".
 */
export function registerCollectionTools<TUser>(
  server: McpServer,
  collections: ToolCollectionExport[],
  currentUser: TUser,
  filterConfig: CollectionConfiguration,
  requestTelemetry?: RequestTelemetryContext,
  session?: HostedSessionContext,
): number {
  const umbracoVersion = session?.[UMBRACO_VERSION_CONTEXT_KEY];
  let registered = 0;
  for (const collection of collections) {
    const collectionName = collection.metadata.name;
    const tools = collection.tools(currentUser as any, { umbracoVersion });

    for (const tool of tools) {
      if (!shouldIncludeTool(tool, { collectionName, config: filterConfig })) {
        continue;
      }

      const annotations = createToolAnnotations(tool);

      // Record the owning collection for telemetry. This loop is the only place
      // that knows both — `withStandardDecorators` runs in the tool's own file,
      // before collections are assembled. Static config, so sharing it across
      // requests in the isolate is correct.
      registerToolCollection(tool.name, collectionName);

      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations,
          ...(tool._meta ? { _meta: tool._meta } : {}),
        },
        withRequestTelemetryContext(
          withRequestSessionContext(tool.handler as (...args: any[]) => any, session),
          requestTelemetry,
        ) as ToolCallback<typeof tool.inputSchema>
      );
      registered += 1;
    }
  }
  return registered;
}
