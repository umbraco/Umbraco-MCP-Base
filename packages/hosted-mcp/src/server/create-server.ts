/**
 * Per-Request McpServer Factory
 *
 * Creates a fresh McpServer instance per request to prevent response data
 * leakage between clients (required by MCP SDK 1.26.0+).
 *
 * Reuses SDK components for tool filtering, annotations, and decorators.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  shouldIncludeTool,
  createToolAnnotations,
  configureApiClient,
  setCustomTransport,
  createCollectionConfigLoader,
  expandModesToCollections,
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
  try {
    const user = await fetchClient({
      url: "/umbraco/management/api/v1/user/current",
      method: "GET",
    });
    return (user ?? {}) as Record<string, unknown>;
  } catch {
    // If we can't fetch the user, return empty object (tools will be unfiltered)
    return {};
  }
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
   * Optional factory to create the API client used by tool handlers.
   *
   * Tool handlers call `executeGetApiCall((client) => client.someMethod(...))`.
   * The `client` is whatever this factory returns (via `configureApiClient`).
   *
   * If not provided, the Orval-generated client is used automatically via
   * `setCustomTransport()` — the fetch client replaces Axios as the transport
   * so the Orval client's named methods (e.g., `client.getTreeDataTypeRoot()`)
   * work in the Workers runtime.
   *
   * Only provide this if you need a custom client setup beyond the Orval client.
   */
  clientFactory?: () => unknown;
  /** Multi-site deployment configuration (for resolving site-specific URLs and filters) */
  multiSite?: MultiSiteConfig;
  /**
   * Dynamic site resolver. Alternative to `multiSite` for URL-based site routing
   * where sites are resolved dynamically (e.g., from a database or URL pattern)
   * rather than from a static list.
   *
   * When both `multiSite` and `resolveSite` are provided, `resolveSite` takes precedence.
   */
  resolveSite?: SiteResolver;
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
    merged.readOnly = true;
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
  const server = new McpServer({
    name: options.name,
    version: options.version,
  });

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
    throw new Error("Umbraco token not found or expired. Re-authentication required.");
  }

  // Set the fetch client as the transport for UmbracoManagementClient.
  // This makes the Orval-generated API client (with named methods like
  // client.getTreeDataTypeRoot()) use fetch instead of Axios, enabling
  // it to work in the Cloudflare Workers runtime.
  setCustomTransport(fetchClient as any);

  // Configure the API client for tool handlers.
  // If a custom clientFactory is provided, use it; otherwise use the
  // Orval-generated client which now routes through our fetch transport.
  if (options.clientFactory) {
    configureApiClient(options.clientFactory);
  }

  // Fetch current user from Umbraco for per-user tool filtering
  const currentUser = await fetchCurrentUser(fetchClient);

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
  for (const collection of options.collections) {
    const collectionName = collection.metadata.name;
    const tools = collection.tools(currentUser);

    for (const tool of tools) {
      if (!shouldIncludeTool(tool, { collectionName, config: filterConfig })) {
        continue;
      }

      const annotations = createToolAnnotations(tool);

      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations,
        },
        tool.handler
      );
    }
  }

  return server;
}
