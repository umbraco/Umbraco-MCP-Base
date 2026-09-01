/**
 * Response Trimmer
 *
 * Utilities for managing context window discipline.
 * Large API responses can overwhelm an LLM's context window.
 * These helpers trim, summarize, and estimate response sizes.
 */

/**
 * Options for trimming array responses.
 */
export interface TrimArrayOptions {
  /** Maximum number of items to include (default: 50) */
  maxItems?: number;
}

/**
 * Limit the number of items in an array response.
 * Adds `_truncated` and `_totalAvailable` metadata when truncated.
 *
 * @param data - The array to trim
 * @param options - Trim options
 * @returns The trimmed data with metadata, or original if not an array / not over limit
 */
export function trimArrayResponse<T>(
  data: T[],
  options?: TrimArrayOptions
): { items: T[]; _truncated: boolean; _totalAvailable: number } {
  const maxItems = options?.maxItems ?? 50;

  if (data.length <= maxItems) {
    return {
      items: data,
      _truncated: false,
      _totalAvailable: data.length,
    };
  }

  return {
    items: data.slice(0, maxItems),
    _truncated: true,
    _totalAvailable: data.length,
  };
}

/**
 * Options for summarizing deep responses.
 */
export interface SummarizeDeepOptions {
  /** Maximum nesting depth before summarizing (default: 3) */
  maxDepth?: number;
}

/**
 * Collapse nested structures beyond a given depth into summaries.
 * Prevents deeply nested API responses from consuming excessive tokens.
 *
 * @param data - The data to summarize
 * @param options - Summary options
 * @returns The data with deep structures collapsed
 */
export function summarizeDeepResponse(
  data: unknown,
  options?: SummarizeDeepOptions
): unknown {
  const maxDepth = options?.maxDepth ?? 3;
  return summarizeAtDepth(data, 0, maxDepth);
}

function summarizeAtDepth(value: unknown, currentDepth: number, maxDepth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (currentDepth >= maxDepth) {
    if (Array.isArray(value)) {
      return `[Array: ${value.length} items]`;
    }
    const keys = Object.keys(value as Record<string, unknown>);
    return `{Object: ${keys.length} keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", ..." : ""}}`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => summarizeAtDepth(item, currentDepth + 1, maxDepth));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = summarizeAtDepth(val, currentDepth + 1, maxDepth);
  }
  return result;
}

/**
 * Rough token size estimator (chars / 4).
 * Useful for making dynamic decisions about whether to trim responses.
 *
 * @param data - The data to estimate
 * @returns Estimated token count
 */
export function estimateTokenSize(data: unknown): number {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return Math.ceil(json.length / 4);
}

/**
 * Pick only specified top-level keys from a response object.
 *
 * Note: for a paginated tool, dropping `total` here drops `nextCursor` and logs
 * a `[cursor-pagination]` warning to stderr (see cursor-pagination.ts) — keep
 * `total` in `fields` alongside `items`.
 *
 * @param data - The response object
 * @param fields - Keys to include
 * @returns A new object with only the specified keys
 */
export function pickFields<T extends Record<string, unknown>>(
  data: T,
  fields: string[]
): Partial<T> {
  const result: Partial<T> = {};
  for (const field of fields) {
    if (field in data) {
      (result as any)[field] = data[field];
    }
  }
  return result;
}

/**
 * Omit specified top-level keys from a response object.
 *
 * Note: never include `total` in `fields` for a paginated tool's response —
 * doing so drops `nextCursor` and logs a `[cursor-pagination]` warning to
 * stderr (see cursor-pagination.ts).
 *
 * @param data - The response object
 * @param fields - Keys to exclude
 * @returns A new object without the specified keys
 */
export function omitFields<T extends Record<string, unknown>>(
  data: T,
  fields: string[]
): Partial<T> {
  const result: Partial<T> = { ...data };
  for (const field of fields) {
    delete (result as any)[field];
  }
  return result;
}
