/**
 * Cloudflare Worker Entry Point
 *
 * Hosted MCP server deployment for Cloudflare Workers.
 * Uses the same tool collections as the stdio entry point (index.ts)
 * but runs over Streamable HTTP with OAuth authentication.
 *
 * NOTE: This file is built by wrangler (not tsup) because it uses
 * Wrangler virtual modules (`agents/mcp`, `@cloudflare/workers-oauth-provider`).
 *
 * Deployment:
 *   npx wrangler dev     # Local development
 *   npx wrangler deploy  # Production deployment
 *
 * See wrangler.toml for configuration.
 */

// Wrangler virtual modules (resolved at wrangler build time)
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

// Hosted MCP building blocks
import {
  createDefaultHandler,
  createWorkerExport,
  createPerRequestServer,
  createSiteRoutingApiHandler,
  getServerOptions,
  type HostedMcpEnv,
  type AuthProps,
  // Uncomment for in-process chaining:
  // registerChainedTools,
  // type ChainedServerConsentConfig,
} from "@umbraco-cms/mcp-hosted";

// Uncomment to host this MCP across multiple Umbraco Cloud projects from a
// single Worker (`/at/{project-alias}/`):
// import { umbracoCloudSiteRouting } from "@umbraco-cms/mcp-hosted/cloud";

// Import tool collections and registries (shared with stdio mode via collections.ts)
import { collections, allModes, allModeNames, allSliceNames } from "./collections.js";

// Import the Orval-generated API client (same factory as stdio mode)
import { getExampleUmbracoAddOnAPI } from "./umbraco-api/api/generated/exampleApi.js";

// Uncomment for in-process chaining:
// import {
//   collections as chainedCollections,
//   allModes as chainedModes,
//   allModeNames as chainedModeNames,
//   allSliceNames as chainedSliceNames,
//   UmbracoManagementClient as ChainedClient,
// } from "@umbraco-cms/mcp-dev/collections";

// ============================================================================
// Server Configuration
// ============================================================================

// Uncomment for in-process chaining — registers the chained server's modes
// on the consent screen so users can select which tool groups to enable:
//
// const cmsChainedServer: ChainedServerConsentConfig = {
//   name: "cms",
//   displayName: "umbraco-cms-mcp",
//   modeRegistry: chainedModes,
//   collections: chainedCollections,
//   allModeNames: chainedModeNames,
//   allSliceNames: chainedSliceNames,
// };

const options = {
  name: "my-umbraco-mcp",
  version: "1.0.0",
  collections,
  modeRegistry: allModes,
  allModeNames,
  allSliceNames,
  // Connect the Orval-generated API client so tool handlers can call
  // Umbraco's Management API using the authenticated user's token.
  clientFactory: () => getExampleUmbracoAddOnAPI(),
  // Show tool mode/collection/slice checkboxes on the consent screen
  enableConsentToolSelection: true,
  // Show "Log in as different user" button on the consent screen after first auth
  authOptions: { showReauthButton: true },
  // Optional server-level instructions sent to clients on `initialize`. Most
  // clients fold this into the model's system prompt, so it applies implicitly
  // without per-tool repetition. Can also be a `(props, env) => string` callback
  // for per-site / per-user guidance in multi-site deployments.
  //
  // instructions: "When summarising results, refer to items by name, not by ID.",
  //
  // Uncomment for in-process chaining — adds chained server modes to consent screen:
  // chainedServers: [cmsChainedServer],
  //
  // Uncomment to host one Worker that serves every Umbraco Cloud project the
  // standardised MCP client is registered in. MCP clients connect to
  // `https://<your-worker-host>/at/<project-alias>/` and the worker resolves
  // each project on demand.
  //
  // Each Cloud project must:
  //   1. Register an OAuth client with this client_id (public/PKCE
  //      recommended) — see umbraco/McpOAuthComposer.cs.
  //   2. Add the Cloud-only short-circuit composer that lets cold-start MCP
  //      clients reach Umbraco ID SSO — see
  //      umbraco/McpExternalLoginShortCircuitComposer.Cloud.cs.
  //
  // siteRouting: umbracoCloudSiteRouting({
  //   oauthClientId: "mcp-cms-editor",  // the client_id registered in each project
  //   // region: "euwest01",              // or set env.UMBRACO_CLOUD_REGION
  // }),
};

const serverOptions = getServerOptions(options);

// ============================================================================
// McpAgent Durable Object
// ============================================================================

/**
 * Durable Object class for stateful MCP sessions.
 * Each MCP client connection gets its own instance.
 * Wrangler resolves `McpAgent` from the `agents/mcp` virtual module.
 */
export class UmbracoMcpAgent extends McpAgent<HostedMcpEnv, unknown, AuthProps> {
  server!: McpServer;

  async init() {
    this.server = await createPerRequestServer(
      serverOptions,
      this.env,
      this.props!
    );

    // ========================================================================
    // In-Process Chaining (uncomment to enable)
    // ========================================================================
    // Chain another MCP server's tools into this worker. Tools are bundled
    // in-process (no subprocess), proxied with a prefix (e.g. "cms--get-document"),
    // and filtered by the user's consent screen selections.
    //
    // await registerChainedTools({
    //   server: this.server,
    //   env: this.env,
    //   props: this.props!,
    //   chainedServer: { ...cmsChainedServer, clientFactory: () => ChainedClient.getClient() },
    // });
  }
}

// ============================================================================
// Worker Export
// ============================================================================

/**
 * Main Worker fetch handler wrapped with OAuthProvider.
 *
 * OAuthProvider (from `@cloudflare/workers-oauth-provider`) handles:
 * - /.well-known/oauth-authorization-server (metadata discovery)
 * - /authorize (authorization endpoint)
 * - /token (token endpoint)
 * - /register (dynamic client registration - RFC 7591)
 * - /mcp (MCP protocol via Streamable HTTP, authenticated — internally)
 *
 * createWorkerExport() wraps the provider so that the MCP endpoint is
 * externally accessible at `/` (browser visits get the landing page,
 * MCP requests are rewritten from `/` to `/mcp` for OAuthProvider).
 *
 * apiRoute also includes `/at/` so per-project URLs like `/at/{alias}/` work
 * when `siteRouting` is enabled. The OAuth access token's `aud` claim is bound
 * to the original `/at/{alias}` URL (per the MCP spec's resource-indicator
 * requirement); OAuthProvider must see that URL to validate the token. The
 * `/at/{alias}/` → `/mcp` rewrite happens INSIDE `apiHandler` below, after
 * token validation.
 */
const provider = new OAuthProvider({
  apiRoute: ["/mcp", "/at/"],
  apiHandler: createSiteRoutingApiHandler(
    UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }) as { fetch: (r: Request, e: HostedMcpEnv, c: ExecutionContext) => Promise<Response> }
  ) as any,
  defaultHandler: createDefaultHandler(options) as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default createWorkerExport(provider, options);
