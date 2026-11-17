/**
 * Stripped argument keys
 *
 * A plain `z.object` strips keys it doesn't declare, so a misspelled argument
 * (`mandatory` for `required`, `id` for `workspaceId`) is dropped without a word
 * and the call goes ahead without it. `findStrippedArgKeys` compares the raw
 * arguments with what the schema parse returned and gives the path of every
 * key that didn't survive, at any depth, so a caller can say so.
 *
 * Comparing against the parse output, rather than walking the schema, reports
 * exactly what was dropped whichever union option matched, and needs no
 * knowledge of Zod's internals. The trade-off: a schema that transforms an
 * object into one with different keys has its original keys reported.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(raw: unknown, parsed: unknown, path: string, out: string[]): void {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw.forEach((item, i) => walk(item, parsed[i], `${path}[${i}]`, out));
    return;
  }
  if (!isPlainObject(raw) || !isPlainObject(parsed)) return;
  for (const [key, child] of Object.entries(raw)) {
    const childPath = path ? `${path}.${key}` : key;
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      walk(child, parsed[key], childPath, out);
    } else {
      out.push(childPath);
    }
  }
}

/**
 * Returns the path of every key in `rawArgs` that is missing from `parsedArgs`
 * (the result of parsing `rawArgs` with the tool's input schema), e.g.
 * `["mandatory", "fields[0].colour"]`.
 */
export function findStrippedArgKeys(rawArgs: unknown, parsedArgs: unknown): string[] {
  const out: string[] = [];
  walk(rawArgs, parsedArgs, "", out);
  return out;
}
