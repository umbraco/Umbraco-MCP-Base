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
import { resolveToolCallParams } from "./tool-call-params.js";

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
 * the host's contract and must pass through verbatim). Also the escape hatch
 * for secret-like string fields whose names don't match the end-anchored
 * `password` / `secret` name rule. Prefer `[text]` for free text: `[raw]`
 * also drops the control-character check.
 */
export const RAW_FIELD_MARKER = "[raw]";

/**
 * Marker that can appear in a Zod field's `.describe()` to mark it as free
 * text: its strings get only the control-character check. Use it on top-level
 * free-text params (e.g. a `name` spread from a request body) that would
 * otherwise get the URL-shaped checks. On an object or array it applies to the
 * subtree, but nested id-, path- or name-named fields below keep their checks.
 */
export const TEXT_FIELD_MARKER = "[text]";

/**
 * How strictly a string leaf is checked. The control-character check always
 * runs; higher levels add the URL-shaped checks.
 */
const CONTROL_ONLY = 0;
const TRAVERSAL = 1;
const FULL = 2;
type CheckLevel = typeof CONTROL_ONLY | typeof TRAVERSAL | typeof FULL;

const LEVEL_OPTIONS: Record<CheckLevel, SanitizeStringOptions | undefined> = {
  [CONTROL_ONLY]: { allowPathTraversal: true, allowQueryParams: true, allowPreEncoded: true },
  [TRAVERSAL]: { allowQueryParams: true, allowPreEncoded: true },
  [FULL]: undefined,
};

/**
 * Name rule for secret-bearing string fields: a key ending in `password` or
 * `secret` (case-insensitive) holds free text, not a URL fragment, so the
 * path-traversal, query-param and pre-encoded checks are skipped. The
 * control-character check still runs. Anchored at the end of the key, so
 * `passwordHint` is still fully checked. Use `[raw]` for secret fields whose
 * names don't match.
 */
const SECRET_FIELD_NAME = /(password|secret)$/i;

/**
 * Name rule for free-text fields (`description`, `translation`, `pageTitle`,
 * `filterText`, `meta_description`, …): never a path parameter, so only the
 * control-character check runs, even at the top level. The word must be the
 * whole key (case-insensitive), follow `_`, or be a capitalised camelCase
 * suffix after a lowercase letter or digit — so `context`, `subtitle` and
 * `ciphertext` are not free text. Anchored at the end of the key, so `textId`
 * is not free text either.
 */
const FREE_TEXT_FIELD_NAME =
  /^(description|translation|text|message|comment|title|label)$|_(description|translation|text|message|comment|title|label)$/i;
const FREE_TEXT_FIELD_SUFFIX = /[a-z0-9](Description|Translation|Text|Message|Comment|Title|Label)$/;

/**
 * Identifier-named keys: `id`, `ids`, `parentId`, `parentID`, `parent_id`,
 * `documentTypeIds`, `mediaUUID`, `guid`, `key`, `keys`, `documentTypeKeys`,
 * `unique`, `alias`, `aliases`, `path`, `paths`, `folderPath`, …. These are what a handler routes into a URL path, and a real
 * identifier never contains `?`, `&`, `%xx` or `../`, so they keep every check
 * at any depth. A camelCase suffix must follow a lowercase letter or digit, so
 * `valid`, `android`, `PAID` and `BIDs` don't match.
 */
const ID_FIELD_NAME =
  /^(ids?|uuids?|guids?|keys?|uniques?|alias(es)?|paths?)$|_(ids?|uuids?|guids?|keys?|alias(es)?|paths?)$/i;
const ID_FIELD_SUFFIX = /[a-z0-9](Ids?|IDs?|Uuids?|UUIDs?|Guids?|GUIDs?|Keys?|Alias(es)?|Paths?)$/;

/**
 * Name-named keys (`name`, `fileName`, `folderName`, `parent_name`, …). File
 * entities build filesystem paths from these, so they keep the path-traversal
 * check at any depth; `?` / `&` / `%xx` are allowed (`Q&A` is a valid name).
 */
const NAME_FIELD_NAME = /name$/i;

function isIdFieldName(key: string): boolean {
  return ID_FIELD_NAME.test(key) || ID_FIELD_SUFFIX.test(key);
}

/** True when a declared key's name says its value is a secret or free text. */
function isRelaxedFieldName(key: string): boolean {
  return SECRET_FIELD_NAME.test(key) || FREE_TEXT_FIELD_NAME.test(key) || FREE_TEXT_FIELD_SUFFIX.test(key);
}

/** The check level a declared key's name implies, independent of depth. */
function checkLevelForKey(key: string): CheckLevel {
  if (isIdFieldName(key)) return FULL;
  if (NAME_FIELD_NAME.test(key)) return TRAVERSAL;
  return CONTROL_ONLY;
}

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
 * A marker may appear on the user-facing schema OR on the unwrapped inner
 * schema — check both. Avoids surprises like `.optional().describe("[raw]")`
 * vs `.describe("[raw]").optional()`.
 */
function hasMarker(schema: any, inner: any, marker: string): boolean {
  const outerDesc = schema?.description;
  if (typeof outerDesc === "string" && outerDesc.includes(marker)) return true;
  const innerDesc = inner?.description;
  if (typeof innerDesc === "string" && innerDesc.includes(marker)) return true;
  return false;
}

/**
 * Pass-through scalar schema kinds — sanitiser doesn't need to do anything
 * because they can't carry agent-supplied string content.
 */
const PASSTHROUGH_SCALAR_TAGS = new Set([
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
 * Tries every option in a `z.union` / `z.discriminatedUnion` against the
 * runtime value, sanitising under the first one whose tag is compatible
 * with the value's JS type. Falls through silently if no option matches —
 * Zod parse upstream of the handler is what enforces the shape; the
 * sanitiser only needs to sanitise string content where the runtime
 * value tells it where strings live.
 */
function sanitizeUnion(
  value: unknown,
  inner: any,
  fieldPath: string,
  level: CheckLevel,
  floor: CheckLevel
): void {
  const options = inner?._def?.options;
  if (!Array.isArray(options)) return;
  for (const option of options) {
    const optInner = unwrapSchema(option);
    if (hasMarker(option, optInner, RAW_FIELD_MARKER)) return;
    const optTag = getZodTypeTag(optInner);
    const compatible =
      (optTag === "string" && typeof value === "string") ||
      (optTag === "array" && Array.isArray(value)) ||
      (optTag === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) ||
      (optTag === "record" && value !== null && typeof value === "object" && !Array.isArray(value)) ||
      (optTag === "number" && typeof value === "number") ||
      (optTag === "boolean" && typeof value === "boolean") ||
      (optTag === "null" && value === null) ||
      (optTag === "undefined" && value === undefined) ||
      (optTag && PASSTHROUGH_SCALAR_TAGS.has(optTag));
    if (compatible) {
      sanitizeAgainstSchema(value, option, fieldPath, level, floor);
      return;
    }
  }
}

/**
 * Recursively sanitises terminal `ZodString` leaves within `value`,
 * descending through `z.object()`, `z.array()`, `z.record()` and
 * `z.union()` / `z.discriminatedUnion()` containers along the way. Never
 * reshapes the input — only throws on bad string content. A subtree
 * marked `[raw]` is skipped wholesale.
 *
 * `level` is how strictly string leaves at this node are checked; array
 * elements and record values inherit it. A child of an object gets the level
 * its declared key implies (`checkLevelForKey`), raised to `floor`. `floor` is
 * the strictest level an ancestor's key implied, so everything under an
 * id-named key (`ids: [{ value }]`, `parentId: { value }`) stays fully
 * checked — except keys matching the secret / free-text name rule, which get
 * only the control-character check even under an id-named ancestor. A
 * `[text]`-marked node also drops to control characters only.
 *
 * Truly unknown schema kinds (`z.tuple`, `z.lazy`, `z.intersection`,
 * `z.map`, `z.set`) throw — silent fall-through would leave nested string
 * content un-sanitised. Authors hitting the error can mark the field
 * `[raw]` after deciding how to validate its contents.
 */
function sanitizeAgainstSchema(
  value: unknown,
  schema: any,
  fieldPath: string,
  level: CheckLevel,
  floor: CheckLevel
): void {
  if (!schema) return;
  const inner = unwrapSchema(schema);
  if (hasMarker(schema, inner, RAW_FIELD_MARKER)) return;
  if (hasMarker(schema, inner, TEXT_FIELD_MARKER)) {
    level = CONTROL_ONLY;
    floor = CONTROL_ONLY;
  }
  const tag = getZodTypeTag(inner);

  if (!tag) return;

  if (tag === "string") {
    if (typeof value === "string") sanitizeStringInput(value, fieldPath, LEVEL_OPTIONS[level]);
    return;
  }

  if (tag === "array") {
    if (!Array.isArray(value)) return;
    const element = inner._def?.element;
    if (element) {
      value.forEach((item, idx) =>
        sanitizeAgainstSchema(item, element, `${fieldPath}[${idx}]`, level, floor)
      );
    }
    return;
  }

  if (tag === "object") {
    if (value === null || typeof value !== "object") return;
    const shape = inner.shape;
    if (shape && typeof shape === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!Object.prototype.hasOwnProperty.call(shape, k)) continue;
        const child = shape[k];
        if (!child) continue;
        if (isRelaxedFieldName(k)) {
          sanitizeAgainstSchema(v, child, `${fieldPath}.${k}`, CONTROL_ONLY, floor);
        } else {
          const childLevel = Math.max(checkLevelForKey(k), floor) as CheckLevel;
          sanitizeAgainstSchema(v, child, `${fieldPath}.${k}`, childLevel, childLevel);
        }
      }
    }
    return;
  }

  if (tag === "record") {
    // `z.record(keySchema, valueSchema)` — every value in the runtime
    // object is sanitised under the value schema. Orval emits this for
    // free-form maps like webhook headers. Values inherit the record's own
    // level (a top-level map may be forwarded as query params). The keys are
    // caller-chosen, so their names never raise or relax the checks.
    if (value === null || typeof value !== "object") return;
    const valueSchema = inner._def?.valueType;
    if (!valueSchema) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      sanitizeAgainstSchema(v, valueSchema, `${fieldPath}.${k}`, level, floor);
    }
    return;
  }

  if (tag === "union" || tag === "discriminatedUnion") {
    sanitizeUnion(value, inner, fieldPath, level, floor);
    return;
  }

  if (PASSTHROUGH_SCALAR_TAGS.has(tag)) return;

  // Unknown container — refuse to fail open. Mark the field `[raw]` if
  // you don't validate its shape.
  throw new Error(
    `withInputSanitization: unsupported schema kind '${tag}' for field '${fieldPath}'. ` +
    `Sanitiser walks z.object()/z.array()/z.record()/z.union() and primitives; other ` +
    `containers (z.tuple, z.lazy, z.intersection, z.map, z.set, …) would silently bypass ` +
    `sanitisation on nested strings. Mark the field '.describe("[raw]")' if you don't validate ` +
    `its shape, or restructure as a supported kind.`
  );
}

/**
 * Decorator that sanitises terminal string inputs against agent hallucinations.
 *
 * Walks the tool's `inputSchema` recursively. Terminal `ZodString` leaves at
 * any depth are checked. Nested `ZodObject` and `ZodArray` containers are
 * descended into structurally — the handler receives the input verbatim (no
 * reshaping, no key reordering, no copies).
 *
 * The control-character check runs on every string. The URL-shaped checks
 * (path traversal `../`, query characters `?` / `&`, pre-encoding `%xx`)
 * depend on where the string sits and what its key is called:
 * - Top-level params (strings on the input object, in a top-level array or in
 *   a top-level record) can be used to build a URL path or query, so they get
 *   every check.
 * - Nested fields with an identifier name (`id`, `ids`, `parentId`,
 *   `parent_id`, `mediaUUID`, `guid`, `key`, `keys`, `unique`, `alias`,
 *   `aliases`, `path`, `paths`, `folderPath`, …) get every check, and so does
 *   everything below them — except keys matching the secret / free-text name
 *   rule below, which get only the control-character check.
 * - Nested fields whose name ends in `name` (`name`, `fileName`) keep the
 *   path-traversal check, since file entities build paths from them.
 * - Any other nested string (request-body text such as
 *   `data.properties[0].description`) gets only the control-character check,
 *   so free text like `Wat zoek je?` round-trips.
 *
 * Fields whose name ends in `password` / `secret` (case-insensitive), or
 * whose name is, ends in `_` plus, or has a camelCase suffix of `description`,
 * `translation`, `text`, `message`, `comment`, `title` / `label` (`pageTitle`,
 * `meta_description`; not `context` or `subtitle`), get only the
 * control-character check at any depth, even under an id-named ancestor. Mark
 * other free-text fields `[text]` for the same effect — for example a
 * top-level `name` spread from a request body. Don't route a relaxed field
 * into a URL path.
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
    handler: ((...params: any[]) => {
      // `args` is `undefined` (not `extra` mis-bound to it) for a schema-less
      // tool — see tool-call-params.ts. `tool.inputSchema` is also falsy for
      // such a tool, so the sanitisation loop below never ran against `extra`
      // in practice, but the final forward did — fixed alongside it.
      const { args, context } = resolveToolCallParams(params) as {
        args: Record<string, unknown> | undefined;
        context: any;
      };
      if (args && typeof args === "object" && tool.inputSchema) {
        const schema = tool.inputSchema as Record<string, any>;
        for (const [key, value] of Object.entries(args)) {
          if (Object.prototype.hasOwnProperty.call(schema, key)) {
            // Every top-level param may reach a URL; only its own key's
            // level carries down into nested objects.
            const relaxed = isRelaxedFieldName(key);
            const keyFloor = relaxed ? CONTROL_ONLY : checkLevelForKey(key);
            sanitizeAgainstSchema(value, schema[key], key, relaxed ? CONTROL_ONLY : FULL, keyFloor);
          } else if (typeof value === "string") {
            // Top-level string not in the declared shape — the upstream MCP
            // SDK strips unknown keys via Zod parse, but the decorator is
            // standalone-consumable (in-process MCP, tests). Fall back to
            // string sanitisation so a path-traversal/control-char value
            // can't reach the handler if the caller didn't run validation.
            // The key is caller-chosen, so it never relaxes the checks.
            sanitizeStringInput(value, key);
          }
        }
      }

      // Forward the SDK's own call shape unchanged, not the just-derived
      // args/context — preserves the original arity for the next decorator.
      return (originalHandler as (...a: any[]) => any)(...params);
    }) as import("@modelcontextprotocol/sdk/server/mcp.js").ToolCallback<Args>,
  };
}
