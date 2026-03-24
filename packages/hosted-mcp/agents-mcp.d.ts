/**
 * Type declarations for the `agents/mcp` Wrangler virtual module.
 *
 * Wrangler resolves this module at build time from the Cloudflare agents
 * runtime. This file provides types for tsc so that consumer worker.ts
 * files can import { McpAgent } from "agents/mcp" without type errors.
 *
 * Consumers of @umbraco-cms/mcp-hosted get these types automatically.
 */
declare module "agents/mcp" {
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

  interface ServeOptions {
    binding?: string;
    corsOptions?: unknown;
    transport?: string;
    jurisdiction?: string;
  }

  abstract class McpAgent<
    Env = unknown,
    State = unknown,
    Props extends Record<string, unknown> = Record<string, unknown>,
  > {
    env: Env;
    props?: Props;
    abstract server: McpServer;
    abstract init(): Promise<void>;

    static serve(
      path: string,
      options?: ServeOptions,
    ): {
      fetch<E>(
        this: void,
        request: Request,
        env: E,
        ctx: ExecutionContext,
      ): Promise<Response>;
    };
  }

  export { McpAgent };
}
