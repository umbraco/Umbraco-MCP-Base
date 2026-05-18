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
    /**
     * Cloudflare Durable Object context (env, storage, blockConcurrencyWhile,
     * etc.). Typed as `any` because the precise shape comes from the Workers
     * runtime types which are environment-specific.
     */
    ctx: any;
    abstract server: McpServer;
    abstract init(): Promise<void>;

    /**
     * Wrapper around `init()` that the partyserver-based runtime invokes the
     * first time a Durable Object instance handles a request after wake or
     * cold-start. Consumers can override to add per-start logging or perform
     * extra setup outside of `init()`. Always call `super.onStart(props)`
     * unless you understand the full transport-wiring it performs.
     *
     * See umbraco/Umbraco-MCP-Base#132 for the failure mode where this hook
     * fails to fire on some hibernation wake paths.
     */
    onStart?(props?: Props): Promise<void>;

    /**
     * Re-issues the cached `initialize` request through the transport so the
     * MCP protocol state matches what the client expects after a server-side
     * rebuild. Already called by `onStart`; override only if you need to
     * pre-empt the replay (e.g. to skip stale session restoration).
     */
    reinitializeServer?(): Promise<void>;

    /**
     * Cached `initialize` request from the current MCP session, retrieved
     * from Durable Object storage. Returns `undefined` before the first
     * initialize handshake completes.
     */
    getInitializeRequest?(): Promise<unknown>;

    /** Returns the MCP session id parsed from the Durable Object name. */
    getSessionId?(): string;

    /**
     * Error hook invoked by the agents runtime when an unhandled error
     * surfaces inside a connection/transport. Override to log structured
     * stack traces (the default surface is opaque) — note that you MUST
     * re-throw (or never return) to preserve framework behaviour.
     */
    onError?(connectionOrError: unknown, error?: unknown): never;

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
