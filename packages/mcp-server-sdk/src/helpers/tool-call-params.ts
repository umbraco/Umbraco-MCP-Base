/**
 * Tool-Call Argument Shape
 *
 * The MCP SDK invokes a registered tool callback as `(args, extra)` when the
 * tool declares an `inputSchema`, and as `(extra)` alone when it doesn't —
 * `extra` (`RequestHandlerExtra`) is always the last parameter, never a fixed
 * index. A decorator that hard-destructures `(args, context)` silently binds
 * `extra` to `args` for every schema-less tool, losing `context` (and
 * anything a host attached to it, e.g. `telemetry/request-context.ts`'s
 * carrier) for that tool's entire decorator chain.
 *
 * Every decorator in `withStandardDecorators` must derive the split this way
 * rather than assume it — one place, so a future one can't reintroduce the
 * bug by copying the wrong decorator as a template.
 */

/** Index of `extra` in a tool callback's raw call params — never a fixed 1. */
export function toolCallExtraIndex(params: readonly unknown[]): 0 | 1 {
  return params.length >= 2 ? 1 : 0;
}

/** Splits a tool callback's raw call params into `args` (absent when there's no schema) and `extra`. */
export function resolveToolCallParams(params: readonly unknown[]): { args: unknown; context: unknown } {
  return toolCallExtraIndex(params) === 1
    ? { args: params[0], context: params[1] }
    : { args: undefined, context: params[0] };
}
