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
 * Reject path traversal sequences (../, ..\, absolute paths).
 * Prevents agents from hallucinating file system paths into API parameters.
 *
 * @throws ToolValidationError if path traversal is detected
 */
export function rejectPathTraversal(value: string, fieldName: string): void {
  if (/\.\.[\\/]/.test(value) || /^[/\\]/.test(value) || /^[a-zA-Z]:[\\/]/.test(value)) {
    throw new ToolValidationError({
      title: "Invalid Input",
      detail: `Field '${fieldName}' contains a path traversal or absolute path. Use a relative identifier (e.g., a name or UUID), not a file system path.`,
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
 * Marker string that can be included in a Zod field's `.describe()` to skip sanitization.
 * Fields with `[raw]` in their description are assumed to contain user-provided content
 * (e.g., HTML body, markdown) and bypass the sanitizer.
 */
export const RAW_FIELD_MARKER = "[raw]";

/**
 * Decorator that automatically sanitizes all string input fields.
 * Walks the tool's inputSchema and runs sanitizeStringInput on each string value.
 * Fields with `[raw]` in their Zod `.describe()` are skipped.
 *
 * @param tool - The tool definition to wrap
 * @returns A new tool definition with input sanitization
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
      // Sanitize all string fields in the input
      if (args && typeof args === "object" && tool.inputSchema) {
        const schema = tool.inputSchema as import("zod").ZodRawShape;

        for (const [key, value] of Object.entries(args)) {
          if (typeof value !== "string") continue;

          // Check if the field's Zod schema has [raw] in its description
          const fieldSchema = schema[key];
          if (fieldSchema && typeof fieldSchema === "object" && "description" in fieldSchema) {
            const desc = (fieldSchema as any).description;
            if (typeof desc === "string" && desc.includes(RAW_FIELD_MARKER)) {
              continue; // Skip raw fields
            }
          }

          sanitizeStringInput(value, key);
        }
      }

      return originalHandler(args as any, context);
    }) as import("@modelcontextprotocol/sdk/server/mcp.js").ToolCallback<Args>,
  };
}
