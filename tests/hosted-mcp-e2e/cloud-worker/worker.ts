/**
 * Cloud-routing worker entry — used by the Cloud E2E test.
 *
 * Mirrors `template/src/worker.ts` but enables `umbracoCloudSiteRouting`
 * so requests to `/at/{project-alias}/` are routed to the matching Umbraco
 * Cloud project. The standardised OAuth client_id comes from
 * `env.UMBRACO_CLOUD_OAUTH_CLIENT_ID`.
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

import {
  createDefaultHandler,
  createWorkerExport,
  createPerRequestServer,
  getServerOptions,
  type HostedMcpEnv,
  type AuthProps,
} from "@umbraco-cms/mcp-hosted";
import { umbracoCloudSiteRouting } from "@umbraco-cms/mcp-hosted/cloud";

import {
  collections,
  allModes,
  allModeNames,
  allSliceNames,
} from "../../../template/src/collections.js";
import { getExampleUmbracoAddOnAPI } from "../../../template/src/umbraco-api/api/generated/exampleApi.js";

interface CloudWorkerEnv extends HostedMcpEnv {
  UMBRACO_CLOUD_OAUTH_CLIENT_ID: string;
}

function buildOptions(env: CloudWorkerEnv) {
  return {
    name: "cloud-routing-e2e",
    version: "1.0.0",
    collections,
    modeRegistry: allModes,
    allModeNames,
    allSliceNames,
    clientFactory: () => getExampleUmbracoAddOnAPI(),
    enableConsentToolSelection: false,
    siteRouting: umbracoCloudSiteRouting({
      oauthClientId: env.UMBRACO_CLOUD_OAUTH_CLIENT_ID,
    }),
  };
}

export class UmbracoMcpAgent extends McpAgent<
  CloudWorkerEnv,
  unknown,
  AuthProps
> {
  server!: McpServer;

  async init() {
    const options = buildOptions(this.env);
    this.server = await createPerRequestServer(
      getServerOptions(options),
      this.env,
      this.props!,
    );
  }
}

export default {
  async fetch(
    request: Request,
    env: CloudWorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const options = buildOptions(env);
    const baseApiHandler = UmbracoMcpAgent.serve("/mcp", {
      binding: "MCP_AGENT",
    });
    const provider = new OAuthProvider({
      // Include both `/mcp` and `/at/` so OAuthProvider validates the access
      // token audience against the original site-routed URL before the rewrite.
      apiRoute: ["/mcp", "/at/"],
      apiHandler: {
        async fetch(
          req: Request,
          e: CloudWorkerEnv,
          c: ExecutionContext,
        ) {
          const url = new URL(req.url);
          if (url.pathname.startsWith("/at/")) {
            const rewritten = new URL(req.url);
            rewritten.pathname = "/mcp";
            req = new Request(rewritten.toString(), req);
          }
          return (baseApiHandler as any).fetch(req, e, c);
        },
      } as any,
      defaultHandler: createDefaultHandler(options) as any,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
    });

    const worker = createWorkerExport(provider as any, options);
    return worker.fetch(request, env, ctx);
  },
};
