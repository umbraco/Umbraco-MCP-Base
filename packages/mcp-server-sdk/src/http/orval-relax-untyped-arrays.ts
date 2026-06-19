/**
 * Orval input transformer that works around an Umbraco OpenAPI quirk.
 *
 * Some Umbraco 18 schemas (e.g. `ManifestResponseModel.extensions`) are declared
 * as `type: array` with no `items`. Orval generates `zod.array()` with no element
 * schema, which fails to compile. Give every such untyped array an empty `items`
 * schema so it generates `zod.array(zod.any())` instead.
 *
 * Wire into an orval input's `override.transformer`. Typed structurally so the SDK
 * needs no dependency on `orval`; consumers can assign it directly (or cast to
 * orval's `InputTransformerFn` if their config types require it).
 */

/** Minimal shape an orval input transformer needs — just `components.schemas`. */
export type OpenApiDocumentLike = { components?: { schemas?: unknown } };

function fixUntypedArrays(schema: unknown): void {
  if (!schema || typeof schema !== "object") return;
  const node = schema as { type?: unknown; items?: unknown };
  if (node.type === "array" && !node.items) {
    node.items = {};
  }
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (value && typeof value === "object") fixUntypedArrays(value);
  }
}

export function relaxUntypedArrays<T extends OpenApiDocumentLike>(spec: T): T {
  fixUntypedArrays(spec.components?.schemas);
  return spec;
}

export default relaxUntypedArrays;
