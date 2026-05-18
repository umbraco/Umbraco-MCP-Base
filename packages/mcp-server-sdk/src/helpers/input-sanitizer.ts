/**
 * Input Sanitizer
 *
 * Validation functions that harden tool inputs against agent hallucinations.
 * Agents hallucinate differently than humans typo — they produce control characters,
 * path traversals, embedded query params, and pre-encoded strings.
 *
 * All functions throw ToolValidationError with clear messages for agent self-correction.
 */

import { ToolValidationError } from "./tool-validation-error.js";

/**
 * Options for sanitizeStringInput to opt-out of specific checks.
 */
export interface SanitizeStringOptions {
  /** Skip control character check */
  allowControlCharacters?: boolean;
  /** Skip path traversal check */
  allowPathTraversal?: boolean;
  /** Skip embedded query param check */
  allowQueryParams?: boolean;
  /** Skip pre-encoded string check */
  allowPreEncoded?: boolean;
}

/**
 * Reject ASCII control characters (< 0x20) except tab, newline, carriage return.
 * Agents sometimes hallucinate null bytes or other control chars in string fields.
 *
 * @throws ToolValidationError if control characters are found
 */
export function rejectControlCharacters(value: string, fieldName: string): void {
  // Match ASCII control chars (0x00-0x1F) except \t (0x09), \n (0x0A), \r (0x0D)
  const controlCharPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
  if (controlCharPattern.test(value)) {
    throw new ToolValidationError({
      title: "Invalid Input",
      detail: `Field '${fieldName}' contains control characters. Remove any non-printable characters and retry.`,
      extensions: { field: fieldName },
    });
  }
}

/**
 * Reject path traversal sequences (`../`, `..\`).
 *
 * Absolute paths (POSIX `/...`, Windows `C:\...`, UNC `\\server\share`) are
 * intentionally allowed: whether a given absolute path is permitted is a
 * policy decision (e.g. an allowlist with `fs.realpathSync`) that belongs to
 * the consumer, not to a generic input sanitiser. Absolute paths on their own
 * are not a traversal attack — `path.resolve("/etc/passwd")` is just
 * `/etc/passwd`. See https://github.com/umbraco/Umbraco-MCP-Base/issues/86.
 *
 * @throws ToolValidationError if a `..` traversal segment is detected
 */
export function rejectPathTraversal(value: string, fieldName: string): void {
  if (/\.\.[\\/]/.test(value)) {
    throw new ToolValidationError({
      title: "Invalid Input",
      detail: `Field '${fieldName}' contains a path traversal sequence ('../' or '..\\'). Remove the parent-directory segment and provide a direct path or identifier.`,
      extensions: { field: fieldName },
    });
  }
}

/**
 * Reject embedded query parameters in values that should be plain identifiers.
 * Agents sometimes append ?key=value or &key=value to UUIDs and names.
 *
 * @throws ToolValidationError if query parameters are detected
 */
export function rejectEmbeddedQueryParams(value: string, fieldName: string): void {
  if (/[?&]/.test(value)) {
    throw new ToolValidationError({
      title: "Invalid Input",
      detail: `Field '${fieldName}' contains query parameter characters ('?' or '&'). Provide the plain value without URL query parameters.`,
      extensions: { field: fieldName },
    });
  }
}

/**
 * Reject pre-encoded strings (percent-encoded sequences like %20, %2F).
 * Prevents double-encoding when the SDK or transport already handles encoding.
 *
 * @throws ToolValidationError if pre-encoded sequences are detected
 */
export function rejectPreEncodedStrings(value: string, fieldName: string): void {
  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    throw new ToolValidationError({
      title: "Invalid Input",
      detail: `Field '${fieldName}' contains percent-encoded characters (e.g., %20). Provide the plain, unencoded value — encoding is handled automatically.`,
      extensions: { field: fieldName },
    });
  }
}

/**
 * Validate UUID v4 format (common in Umbraco APIs).
 *
 * @throws ToolValidationError if the value is not a valid UUID
 */
export function validateUUID(value: string, fieldName: string): void {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new ToolValidationError({
      title: "Invalid UUID",
      detail: `Field '${fieldName}' must be a valid UUID (e.g., '550e8400-e29b-41d4-a716-446655440000'). Received: '${value}'.`,
      extensions: { field: fieldName },
    });
  }
}

/**
 * Run all sanitization checks on a string value.
 * Use the options parameter to opt-out of specific checks.
 *
 * @throws ToolValidationError if any check fails
 */
export function sanitizeStringInput(
  value: string,
  fieldName: string,
  options?: SanitizeStringOptions
): void {
  if (!options?.allowControlCharacters) {
    rejectControlCharacters(value, fieldName);
  }
  if (!options?.allowPathTraversal) {
    rejectPathTraversal(value, fieldName);
  }
  if (!options?.allowQueryParams) {
    rejectEmbeddedQueryParams(value, fieldName);
  }
  if (!options?.allowPreEncoded) {
    rejectPreEncodedStrings(value, fieldName);
  }
}

/**
 * Marker that can appear in a Zod field's `.describe()` to skip sanitization.
 * Honored on any field at any depth — strings, objects, arrays. Marking an
 * object or array opts the whole subtree out (useful for host-injected payloads
 * like ChatGPT's `openai/fileParams` file references, where the wire shape is
 * the host's contract and must pass through verbatim).
 */
export const RAW_FIELD_MARKER = "[raw]";

/**
 * Walks past wrappers like `ZodOptional` / `ZodDefault` / `ZodNullable` to the
 * inner schema. Zod v4 chains these via `_def.innerType`.
 *
 * Capped at 32 hops as a defensive measure — Zod's real wrappers nest at most
 * 2–3 deep; anything past that is either a hand-built malformed schema or a
 * self-referential cycle, neither of which we want to spin a worker DO on.
 */
function unwrapSchema(schema: any): any {
  for (let i = 0; i < 32; i++) {
    if (!schema?._def?.innerType) return schema;
    schema = schema._def.innerType;
  }
  return schema;
}

/**
 * Returns the Zod type tag normalised to lowercase ("string", "object", "array",
 * etc.). Falls back to the legacy v3 `_def.typeName` for older mocks/tests.
 */
function getZodTypeTag(schema: any): string | undefined {
  if (!schema?._def) return undefined;
  if (typeof schema._def.type === "string") return schema._def.type;
  if (typeof schema._def.typeName === "string") {
    return schema._def.typeName.replace(/^Zod/, "").toLowerCase();
  }
  return undefined;
}

/**
 * `[raw]` may appear on the user-facing schema OR on the unwrapped inner
 * schema — check both. Avoids surprises like `.optional().describe("[raw]")`
 * vs `.describe("[raw]").optional()`.
 */
function hasRawMarker(schema: any, inner: any): boolean {
  const outerDesc = schema?.description;
  if (typeof outerDesc === "string" && outerDesc.includes(RAW_FIELD_MARKER)) return true;
  const innerDesc = inner?.description;
  if (typeof innerDesc === "string" && innerDesc.includes(RAW_FIELD_MARKER)) return true;
  return false;
}

/**
 * Schema kinds the walker explicitly knows how to descend through. Anything
 * else (`z.union`, `z.record`, `z.tuple`, `z.lazy`, etc.) triggers a fail-loud
 * error at handler-invocation time rather than a silent bypass — the easy
 * route is for the author to `.describe("[raw]")` the field after deciding
 * how its contents should be validated.
 */
const SUPPORTED_SCHEMA_TAGS = new Set([
  "string",
  "object",
  "array",
  // Pure pass-throughs — sanitiser doesn't need to do anything for these
  // since they can't carry agent-supplied string content.
  "number",
  "bigint",
  "boolean",
  "date",
  "literal",
  "enum",
  "nativeEnum",
  "null",
  "undefined",
  "void",
  "never",
  "any",
  "unknown",
]);

/**
 * Recursively sanitises terminal `ZodString` leaves within `value`, descending
 * through `z.object()` and `z.array()` containers along the way. Never
 * reshapes the input — only throws on bad string content. A subtree marked
 * `[raw]` is skipped wholesale.
 *
 * Unsupported schema kinds (union / record / tuple / lazy / intersection /
 * discriminatedUnion / map / set) throw — silent fall-through would leave
 * nested string content un-sanitised, which is exactly what this decorator
 * exists to prevent. Authors hitting the error should mark the field
 * `[raw]` after deciding how to validate its contents.
 */
function sanitizeAgainstSchema(value: unknown, schema: any, fieldPath: string): void {
  if (!schema) return;
  const inner = unwrapSchema(schema);
  if (hasRawMarker(schema, inner)) return;
  const tag = getZodTypeTag(inner);

  // Fail loud BEFORE any per-value dispatch — a schema declaring an
  // unsupported container kind (z.union, z.record, z.tuple, z.lazy,
  // z.intersection, z.discriminatedUnion, z.map, z.set, …) would otherwise
  // silently bypass sanitisation on nested strings depending on the runtime
  // value's shape. Force the tool author to mark it `[raw]` after deciding
  // how to validate the contents.
  if (tag && !SUPPORTED_SCHEMA_TAGS.has(tag)) {
    throw new Error(
      `withInputSanitization: unsupported schema kind '${tag}' for field '${fieldPath}'. ` +
      `Sanitiser only descends through z.object() and z.array(); other containers (z.union, z.record, ` +
      `z.tuple, z.lazy, etc.) would silently bypass sanitisation on nested strings. ` +
      `If the field is a host-injected payload whose shape you don't validate, mark it ` +
      `'.describe("[raw]")'. Otherwise restructure as z.object()/z.array().`
    );
  }

  if (typeof value === "string") {
    if (tag === "string") sanitizeStringInput(value, fieldPath);
    return;
  }

  if (Array.isArray(value) && tag === "array") {
    const element = inner?._def?.element;
    if (element) {
      value.forEach((item, idx) => sanitizeAgainstSchema(item, element, `${fieldPath}[${idx}]`));
    }
    return;
  }

  if (value && typeof value === "object" && tag === "object") {
    const shape = inner?.shape;
    if (shape && typeof shape === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!Object.prototype.hasOwnProperty.call(shape, k)) continue;
        const child = shape[k];
        if (child) sanitizeAgainstSchema(v, child, `${fieldPath}.${k}`);
      }
    }
    return;
  }
}

/**
 * Decorator that sanitises terminal string inputs against agent hallucinations.
 *
 * Walks the tool's `inputSchema` recursively. Terminal `ZodString` leaves at
 * any depth are passed through `sanitizeStringInput`. Nested `ZodObject` and
 * `ZodArray` containers are descended into structurally — the handler receives
 * the input verbatim (no reshaping, no key reordering, no copies).
 *
 * Fields whose `.describe()` contains the `[raw]` marker are skipped:
 * - On a `ZodString` field → that string passes through unsanitised.
 * - On a `ZodObject` or `ZodArray` field → the whole subtree passes through.
 *   Use this for host-injected payloads (e.g. ChatGPT's `openai/fileParams`
 *   file references) whose wire shape is fixed by the host.
 *
 * @param tool - The tool definition to wrap
 * @returns A new tool definition with input sanitisation
 */
export function withInputSanitization<
  Args extends undefined | import("zod").ZodRawShape,
  OutputArgs extends undefined | import("zod").ZodRawShape | import("zod").ZodType = undefined
>(
  tool: import("../types/tool-definition.js").ToolDefinition<Args, OutputArgs>
): import("../types/tool-definition.js").ToolDefinition<Args, OutputArgs> {
  const originalHandler = tool.handler;

  return {
    ...tool,
    handler: ((args: Record<string, unknown>, context: any) => {
      if (args && typeof args === "object" && tool.inputSchema) {
        const schema = tool.inputSchema as Record<string, any>;
        for (const [key, value] of Object.entries(args)) {
          if (Object.prototype.hasOwnProperty.call(schema, key)) {
            sanitizeAgainstSchema(value, schema[key], key);
          } else if (typeof value === "string") {
            // Top-level string not in the declared shape — the upstream MCP
            // SDK strips unknown keys via Zod parse, but the decorator is
            // standalone-consumable (in-process MCP, tests). Fall back to
            // string sanitisation so a path-traversal/control-char value
            // can't reach the handler if the caller didn't run validation.
            sanitizeStringInput(value, key);
          }
        }
      }

      return originalHandler(args as any, context);
    }) as import("@modelcontextprotocol/sdk/server/mcp.js").ToolCallback<Args>,
  };
}
