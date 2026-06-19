import fs from "node:fs";
import path from "node:path";

/**
 * Post-processing for orval-generated `.zod.ts` files.
 *
 * Orval 8 changed a few things about its zod output relative to orval 7. These
 * helpers re-align the generated code so hand-written tools and tests keep working
 * unchanged across the upgrade — the generated surface stays the structure orval 7
 * produced. Wire `postProcessZodFiles` into the zod config's `afterAllFilesWrite`
 * hook (cast to orval's `HookFunction` if the config types require it).
 */

/** Resolve the `.zod.ts` files from the list of paths an orval hook receives. */
export function collectZodFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    if (fs.lstatSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (f.endsWith(".zod.ts")) files.push(path.join(p, f));
      }
    } else if (p.endsWith(".zod.ts")) {
      files.push(p);
    }
  }
  return files;
}

/**
 * Replaces `zod.uuid()` with `zod.guid()` in generated `.zod.ts` files.
 *
 * Umbraco uses GUIDs that are not RFC 4122 compliant UUIDs (e.g. sequential
 * version IDs like `0000003f-0000-0000-0000-000000000000`). Zod's `uuid()`
 * enforces RFC 4122 version/variant bits and rejects these. Zod's `guid()`
 * validates the 8-4-4-4-12 hex shape without RFC 4122 constraints.
 */
export function relaxUuidToGuid(paths: string[]): void {
  for (const file of collectZodFiles(paths)) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("zod.uuid()")) {
      fs.writeFileSync(file, content.replaceAll("zod.uuid()", "zod.guid()"), "utf8");
    }
  }
}

/**
 * Lower-cases the first letter of every generated zod schema export.
 *
 * Umbraco's OpenAPI operationIds are PascalCase. Orval 7 camel-cased the zod
 * schema export names derived from them (`GetCulture` -> `getCultureResponse`);
 * orval 8 keeps the PascalCase (`GetCultureResponse`). Hand-written tools import
 * these schemas by their camelCase name, so restoring the casing here keeps the
 * generated zod surface stable across the orval upgrade. Only names declared as
 * `export const` are rewritten, so imported types (`zod`) and object keys are
 * left untouched.
 */
export function camelCaseZodExports(paths: string[]): void {
  for (const file of collectZodFiles(paths)) {
    const content = fs.readFileSync(file, "utf8");

    const names = new Set<string>();
    for (const match of content.matchAll(/export const ([A-Z][A-Za-z0-9_]*)/g)) {
      names.add(match[1]);
    }
    if (names.size === 0) continue;

    const updated = content.replace(/\b[A-Z][A-Za-z0-9_]*\b/g, (id) =>
      names.has(id) ? id.charAt(0).toLowerCase() + id.slice(1) : id
    );
    fs.writeFileSync(file, updated, "utf8");
  }
}

/**
 * Restores orval 7's handling of query params that have a falsy spec default.
 *
 * Umbraco declares query params like `foldersOnly`/`includeAncestors`
 * (`default: false`), `skip` (`default: 0`) and `filter` (`default: ""`). Orval 7
 * emitted these as `.optional()` (it ignored falsy defaults); orval 8 emits
 * `.default(<const>)`, which makes the inferred output type a required field and
 * breaks tools/tests that pass the param as `undefined`. Re-emit them as
 * `.optional()` to keep the v7 surface. Truthy defaults (e.g. `take`'s `100`) are
 * left as `.default(...)`, matching both versions.
 */
export function restoreV7OptionalDefaults(paths: string[]): void {
  for (const file of collectZodFiles(paths)) {
    let content = fs.readFileSync(file, "utf8");

    const falsy = new Set<string>();
    for (const match of content.matchAll(/export const (\w+) = (.+?);/g)) {
      const value = match[2].trim();
      if (["0", "false", "''", '""', "``", "null"].includes(value)) {
        falsy.add(match[1]);
      }
    }
    if (falsy.size === 0) continue;

    for (const name of falsy) {
      content = content.replaceAll(`.default(${name})`, ".optional()");
    }
    fs.writeFileSync(file, content, "utf8");
  }
}

/** Run every zod post-processing step. Use as the zod `afterAllFilesWrite` hook. */
export function postProcessZodFiles(paths: string[]): void {
  relaxUuidToGuid(paths);
  camelCaseZodExports(paths);
  restoreV7OptionalDefaults(paths);
}
