/**
 * Cloudflare Tracing Adapter
 *
 * Implements the SDK's `TelemetryAdapter` on top of Cloudflare's native Workers
 * tracing, so tool-call spans nest inside the platform's automatic
 * instrumentation (handler, KV and Durable Object binding calls, outbound fetch
 * to the Umbraco API) and ride the built-in OTLP export.
 *
 * `tracing` is **injected rather than imported**. `cloudflare:workers` only
 * resolves inside the Workers runtime, so a static import here would break this
 * package's Node unit tests and force the specifier into tsup's externals — the
 * same reason this package already takes `McpAgent` and `OAuthProvider` from the
 * consumer instead of importing them. The consumer's `worker.ts` does:
 *
 * ```ts
 * import { tracing } from "cloudflare:workers";
 * // ...
 * const options = { name, version, collections, telemetry: { tracing } };
 * ```
 *
 * Only the two members actually used are described below, structurally, so this
 * module needs no dependency on `@cloudflare/workers-types` at runtime and can
 * be exercised in tests with a plain fake.
 *
 * Spans still cost nothing when the Worker isn't being traced: `enterSpan`
 * returns an inert span whose `setAttribute` is a no-op (verified against
 * workerd — it is also safe to call outside a request context entirely).
 */

import type { TelemetryAdapter, SpanAttributes, AttributeValue } from "@umbraco-cms/mcp-server-sdk";

/**
 * The span object Cloudflare hands to an `enterSpan` callback.
 *
 * Cloudflare's real span also exposes `isTraced` and `end()`; neither is needed
 * here — `enterSpan` owns the lifecycle, and attributes are cheap enough that
 * gating them on `isTraced` would add a branch for no gain.
 */
export interface CloudflareSpan {
  setAttribute(key: string, value?: AttributeValue): void;
}

/** The subset of `tracing` (from `cloudflare:workers`) this adapter uses. */
export interface CloudflareTracing {
  enterSpan<T>(name: string, callback: (span: CloudflareSpan) => T): T;
}

export interface CloudflareTracingAdapterOptions {
  /** The `tracing` object from `cloudflare:workers`. */
  tracing: CloudflareTracing;
  /**
   * Attributes added to every span this adapter creates.
   *
   * **Must be constant for the lifetime of the Worker** — server name, version,
   * targeted Umbraco major and the like. See `createCloudflareTracingAdapter`
   * for why request-scoped values must not go here.
   */
  attributes?: SpanAttributes;
}

/**
 * Builds a `TelemetryAdapter` backed by Cloudflare's tracing API.
 *
 * ## Why `attributes` is static-only
 *
 * The SDK holds the active adapter in module scope, which is safe precisely
 * because an adapter carries no per-request state. Anything closed over here is
 * therefore shared by every span the isolate records — and a Worker isolate can
 * host more than one Durable Object instance, so values belonging to one
 * session can be read while another session's tool call is being traced.
 *
 * For static facts (which server, which version) that's harmless: they're
 * identical for every request this Worker serves. For request-scoped values it
 * would be a correctness bug of the worst kind — spans attributed to the wrong
 * tenant. That is the same trap `createPerRequestServer` documents for the
 * SDK's version-check singleton.
 *
 * So request-scoped enrichment (`umbraco.mcp.tenant`, `umbraco.mcp.client.*`,
 * the resolved site) is deliberately **not** supported yet. It needs a
 * per-request carrier rather than a closure, and mislabelled tenant data is
 * worse than absent tenant data.
 *
 * @param options - The injected `tracing` object and any static attributes
 * @returns An adapter ready to hand to the SDK's `setTelemetryAdapter`
 */
export function createCloudflareTracingAdapter(
  options: CloudflareTracingAdapterOptions
): TelemetryAdapter {
  const { tracing, attributes: staticAttributes } = options;

  return {
    startSpan: (name, attributes, fn) =>
      tracing.enterSpan(name, (span) => {
        if (staticAttributes) {
          for (const [key, value] of Object.entries(staticAttributes)) {
            span.setAttribute(key, value);
          }
        }
        for (const [key, value] of Object.entries(attributes)) {
          span.setAttribute(key, value);
        }

        // Returning the promise is what ends the span: Cloudflare closes an
        // `enterSpan` span when the callback's returned promise settles, so
        // failures are recorded rather than leaving the span open.
        return fn({
          setAttribute: (key, value) => span.setAttribute(key, value),
        });
      }),
  };
}
