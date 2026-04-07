/**
 * Jest setup for E2E tests — polyfill Symbol.asyncDispose/dispose.
 *
 * The Claude Agent SDK uses `using` declarations internally which require
 * these symbols. In Jest's VM context they're undefined even on Node 22.
 */
(Symbol as any).asyncDispose ??= Symbol.for("Symbol.asyncDispose");
(Symbol as any).dispose ??= Symbol.for("Symbol.dispose");
