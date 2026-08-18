/**
 * Telemetry
 *
 * Span instrumentation for MCP tool calls, with the tracing implementation
 * injected by the host. See `adapter.ts` for why the SDK can't import a tracing
 * API directly.
 */

export {
  setTelemetryAdapter,
  getTelemetryAdapter,
  clearTelemetryAdapter,
  passThroughAdapter,
  type TelemetryAdapter,
  type TelemetrySpan,
  type SpanAttributes,
  type AttributeValue,
} from "./adapter.js";

export {
  registerToolCollection,
  getToolCollection,
  clearToolCollections,
} from "./tool-collection-registry.js";

export { withTelemetry } from "./with-telemetry.js";

export {
  TelemetryAttributes,
  TOOLS_CALL_METHOD,
  type ToolOutcome,
} from "./attributes.js";
