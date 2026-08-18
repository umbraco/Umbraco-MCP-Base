/**
 * Telemetry Adapter
 *
 * The seam between "the SDK knows a tool call happened" and "this host knows
 * how to record a span". The SDK never talks to a tracing API directly, for a
 * hard reason: the hosted Workers record spans via `cloudflare:workers`, a
 * bare specifier only the Workers runtime resolves. Importing it here would
 * break every Node/stdio install of this package. So hosts inject an adapter
 * instead, and this module holds no vendor code.
 *
 * The default adapter is pass-through, so a server that never registers one
 * pays a single function call per tool invocation and allocates nothing — the
 * same "zero overhead when not configured" property Umbraco.AI documents for
 * its OpenTelemetry integration.
 */

/** Span attribute value types. OTel scalars only — serialise anything else at the call site. */
export type AttributeValue = string | number | boolean;

/** A bag of span attributes. */
export type SpanAttributes = Record<string, AttributeValue>;

/**
 * The subset of a span the SDK needs: somewhere to put attributes discovered
 * *during* the call (the outcome, notably).
 *
 * Deliberately not an OTel `Span`. Cloudflare's native span exposes only
 * `isTraced` / `setAttribute` / `end` — no `spanContext()`, no `setAttributes()`
 * — so a richer interface here would be one the primary host can't satisfy.
 * Lifecycle is the adapter's business: `startSpan` owns ending the span.
 */
export interface TelemetrySpan {
  setAttribute(key: string, value: AttributeValue): void;
}

/**
 * Records one span around a tool call.
 *
 * Contract for implementors:
 * - Invoke `fn` exactly once and return (or await) its result.
 * - Propagate whatever `fn` throws, unchanged. Telemetry must never alter what
 *   the caller sees.
 * - End the span when `fn`'s promise settles, including on rejection.
 * - **Don't throw.** `withTelemetry` degrades to an unrecorded call if
 *   `startSpan` fails before reaching `fn`, but an adapter that throws after
 *   the handler has run will surface that error to the caller. Misconfigured
 *   telemetry should be invisible, not an outage.
 */
export interface TelemetryAdapter {
  startSpan<T>(
    name: string,
    attributes: SpanAttributes,
    fn: (span: TelemetrySpan) => Promise<T>
  ): Promise<T>;
}

/** Shared inert span. One object for the whole process — it holds no state. */
const NOOP_SPAN: TelemetrySpan = {
  setAttribute() {
    /* deliberately empty */
  },
};

/**
 * The default: run the call, record nothing.
 *
 * Exported so hosts can restore it explicitly and tests can assert on the
 * unconfigured path.
 */
export const passThroughAdapter: TelemetryAdapter = {
  startSpan: (_name, _attributes, fn) => fn(NOOP_SPAN),
};

let activeAdapter: TelemetryAdapter = passThroughAdapter;

/**
 * Register the adapter used by every subsequent tool call.
 *
 * Module-scoped by design, following the same reasoning as `setServerRef`:
 * a Durable Object is single-threaded, so one module-level value per isolate is
 * safe. The critical difference from the version-check singleton — which must
 * *not* be shared this way — is that an adapter carries **no per-request
 * state**. It is a function. Whatever request-scoped values a host wants on its
 * spans (client name, tenant key) belong in the closure the host builds when it
 * constructs the adapter for that request, never in mutable state here.
 *
 * @param adapter - The adapter to install
 */
export function setTelemetryAdapter(adapter: TelemetryAdapter): void {
  activeAdapter = adapter;
}

/** Returns the active adapter — the pass-through one unless a host registered another. */
export function getTelemetryAdapter(): TelemetryAdapter {
  return activeAdapter;
}

/** Restores the pass-through adapter. Primarily for tests and host teardown. */
export function clearTelemetryAdapter(): void {
  activeAdapter = passThroughAdapter;
}
