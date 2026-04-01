/**
 * Jest setup for eval tests — polyfill Symbol.asyncDispose/dispose.
 *
 * The Claude Agent SDK uses `using` declarations internally (compiled to
 * Symbol.asyncDispose checks). In Jest's VM context, Symbol.asyncDispose
 * is undefined even on Node 22, causing "Object not disposable" errors.
 */
(Symbol as any).asyncDispose ??= Symbol.for("Symbol.asyncDispose");
(Symbol as any).dispose ??= Symbol.for("Symbol.dispose");
