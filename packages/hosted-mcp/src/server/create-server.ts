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
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js";
import { z } from "zod";
import {
  shouldIncludeTool,
  createToolAnnotations,
  configureApiClient,
  setCustomTransport,
  createCollectionConfigLoader,
  expandModesToCollections,
  checkUmbracoVersion,
  VersionCheckService,
  registerToolCollection,
  setTelemetryAdapter,
  getTelemetryAdapter,
  TelemetryAttributes,
  SERVER_INFORMATION_PATH,
  type TelemetrySpan,
  type ToolCollectionExport,
  type ToolModeDefinition,
  type CollectionConfiguration,
  type ServerConfigForCollections,
} from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import type { MultiSiteConfig, SiteConfig } from "../types/multi-site.js";
import { loadWorkerConfig, loadSiteConfig } from "../config/worker-config.js";
import { createFetchClientFromKV } from "../http/umbraco-fetch-client.js";
import type { AuthProps, ConsentChoices } from "../types/auth.js";

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
   * Optional factory to create the API client used by tool handlers.
   *
   * Tool handlers call `executeGetApiCall((client) => client.someMethod(...))`.
   * The `client` is whatever this factory returns (via `configureApiClient`).
   *
   * If not provided, the Orval-generated client is used automatically via
   * `setCustomTransport()` so the Orval client's named methods (e.g.,
   * `client.getTreeDataTypeRoot()`) work in the Workers runtime.
   *
   * Only provide this if you need a custom client setup beyond the Orval client.
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
 * Replaces control characters (newlines, NULs, etc.) in a log token with `?`
 * so user-tainted fields can't forge log lines on `wrangler tail`. Returns
 * `<none>` for null/undefined.
 */
function sanitizeForLog(value: unknown): string {
  if (value === null || value === undefined) return "<none>";
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\x00-\x1F\x7F]/g, "?");
}

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
 * @returns Configured McpServer ready to handle the request
 */
export async function createPerRequestServer(
  options: CreateServerOptions,
  env: HostedMcpEnv,
  props: AuthProps
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
    initPerRequestServer(options, env, props, span)
  );
}

/**
 * The body of `createPerRequestServer`, split out so the whole initialisation
 * sits inside one span. `initSpan` collects the outcome attributes at each exit.
 */
async function initPerRequestServer(
  options: CreateServerOptions,
  env: HostedMcpEnv,
  props: AuthProps,
  initSpan: TelemetrySpan
): Promise<McpServer> {
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
    const server = new McpServer(
      { name: options.name, version: options.version },
      {
        jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
        instructions: baseInstructions,
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
            text: "Your Umbraco authentication has expired or been invalidated. Please disconnect and reconnect this MCP server to trigger a fresh login.",
          },
        ],
        isError: true,
      })
    );
    console.log(
      `[mcp-hosted] createPerRequestServer:done id=${traceId} mode=degraded-auth-expired tools=1 elapsedMs=${Date.now() - initStartedAt}`
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

  async function checkVersion(): Promise<string | null> {
    const versionCheckService = new VersionCheckService();
    await checkUmbracoVersion({
      mcpVersion: options.version,
      expectedUmbracoMajor: expectedUmbracoMajor!,
      client: {
        getServerInformation: async () => {
          const info = (await client({
            url: SERVER_INFORMATION_PATH,
            method: "GET",
          })) as { version: string };
          return { version: info.version };
        },
      },
      service: versionCheckService,
    });
    return versionCheckService.getMessage();
  }

  // Run the version check alongside the current-user fetch below — both are
  // independent reads through the same fetch client, so there's no reason to
  // serialize the two extra round-trips this function makes per request.
  const [versionCheckMessage, currentUser] = await Promise.all([
    expectedUmbracoMajor ? checkVersion() : Promise.resolve(null),
    fetchCurrentUser(fetchClient),
  ]);

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

  // Set the fetch client as the transport for UmbracoManagementClient.
  // This routes the Orval-generated API client (with named methods like
  // client.getTreeDataTypeRoot()) through the Workers-compatible fetch
  // transport configured by the host worker.
  setCustomTransport(fetchClient as any);

  // Configure the API client for tool handlers.
  // If a custom clientFactory is provided, use it; otherwise use the
  // Orval-generated client which now routes through our fetch transport.
  if (options.clientFactory) {
    configureApiClient(options.clientFactory);
  }

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

  // Register tools from all collections (with filtering)
  const registeredCount = registerCollectionTools(server, options.collections, currentUser, filterConfig);

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
 * Iterates collections, filters per the resolved `filterConfig`, and registers
 * each surviving tool on the McpServer.
 *
 * `tool._meta` is forwarded verbatim to `tools/list` so host extensions like
 * OpenAI's `openai/fileParams` reach the client.
 */
export function registerCollectionTools<TUser>(
  server: McpServer,
  collections: ToolCollectionExport[],
  currentUser: TUser,
  filterConfig: CollectionConfiguration,
): number {
  let registered = 0;
  for (const collection of collections) {
    const collectionName = collection.metadata.name;
    const tools = collection.tools(currentUser as any);

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
        tool.handler as ToolCallback<typeof tool.inputSchema>
      );
      registered += 1;
    }
  }
  return registered;
}
