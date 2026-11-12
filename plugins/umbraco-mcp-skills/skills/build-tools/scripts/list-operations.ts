/**
 * List the OpenAPI operations that belong to one `.discover.json` collection.
 *
 * Usage (from the MCP project root, so `.discover.json` is found):
 *   curl -fsSk "<swaggerUrl>" | node list-operations.ts <collection> [--tag <OriginalTag>]
 *
 * Prints one line per operation: `METHOD path operationId - summary` (the
 * summary part is omitted when the operation has none).
 *
 * A collection matches operations whose first tag equals the collection's
 * original tag in `.discover.json`'s `collectionTags`. Untagged operations
 * count as "default", the same way `discover` groups them. If the manifest has
 * no `collectionTags` entry (written by an older `discover`), the spec's tags
 * are printed to stderr and the script exits 1; re-run with `--tag <tag>` to
 * match on one of them directly.
 *
 * Runs on Node's built-in TypeScript type stripping (Node 22.18+), so it uses
 * erasable syntax only and has no dependencies.
 */

import * as fs from "node:fs";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

interface Operation {
  tags?: string[];
  operationId?: string;
  summary?: string;
}

const tagOf = (op: Operation): string => op.tags?.[0] || "default";

function main(): void {
  const args = process.argv.slice(2);
  const tagFlag = args.indexOf("--tag");
  const tagOverride = tagFlag >= 0 ? args[tagFlag + 1] : undefined;
  const collection = args.find((a, i) => !a.startsWith("--") && (tagFlag < 0 || i !== tagFlag + 1));
  if (!collection || (tagFlag >= 0 && !tagOverride)) {
    console.error('Usage: curl -fsSk "<swaggerUrl>" | node list-operations.ts <collection> [--tag <OriginalTag>]');
    process.exit(2);
  }

  let manifest: { collectionTags?: Record<string, string> };
  try {
    manifest = JSON.parse(fs.readFileSync(".discover.json", "utf8"));
  } catch {
    console.error("Could not read .discover.json in the current directory. Run this from the project root.");
    process.exit(2);
  }

  let spec: { paths?: Record<string, Record<string, unknown>> };
  try {
    spec = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    console.error("stdin is not a JSON OpenAPI spec. Pipe it in with: curl -fsSk \"<swaggerUrl>\" | ...");
    process.exit(2);
  }

  const operations: Array<[string, string, Operation]> = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method] as Operation | undefined;
      if (op) operations.push([method, path, op]);
    }
  }

  const tag = tagOverride ?? manifest.collectionTags?.[collection];
  if (!tag) {
    const tags = [...new Set(operations.map(([, , op]) => tagOf(op)))].sort();
    console.error(
      `.discover.json has no collectionTags entry for "${collection}". Re-run with --tag <tag>, using one of the spec's tags: ${tags.join(", ")}`,
    );
    process.exit(1);
  }

  for (const [method, path, op] of operations) {
    if (tagOf(op) === tag) {
      const summary = op.summary ? ` - ${op.summary}` : "";
      console.log(`${method.toUpperCase()} ${path} ${op.operationId ?? "(no operationId)"}${summary}`);
    }
  }
}

main();
