/**
 * Umbraco Cloud `siteId` shape
 *
 * The Cloud preset's `siteId` is either a bare project alias (`"my-project"`)
 * or an alias with its region embedded (`"my-project.euwest01"`), mirroring the
 * project's own hostname `{alias}.{region}.umbraco.io`. Three separate things
 * need to take that string apart — URL composition, the `/callback/<id>` path
 * segment, and telemetry's region attribute — so the shape is defined once
 * here rather than re-guessed at each site.
 */

/**
 * Matches the `.<region>` suffix of a `<alias>.<region>` siteId, e.g.
 * "uksouth01", "euwest01" — a lowercase-letter region name plus a 2-digit
 * instance number. Deliberately narrow so an alias that happens to contain
 * a dot isn't misread as carrying a region.
 */
export const REGION_SUFFIX = /\.[a-z]+\d{2}$/;

/** Whether the siteId carries a `<alias>.<region>` suffix. */
export function hasEmbeddedRegion(siteId: string): boolean {
  return REGION_SUFFIX.test(siteId);
}

/**
 * The alias portion of a `<alias>.<region>` siteId — what a Cloud project's
 * own OAuth client registration (which only knows its own bare alias, not
 * "region" as a concept) expects as the `/callback/<id>` path segment.
 */
export function aliasOnly(siteId: string): string {
  return siteId.replace(REGION_SUFFIX, "");
}

/**
 * The region portion of a `<alias>.<region>` siteId, without the leading dot.
 *
 * Returns `undefined` for a bare alias — a self-hosted or legacy bare-alias
 * site genuinely has no region here, and that must stay absent rather than
 * become a guess.
 */
export function regionOnly(siteId: string): string | undefined {
  const match = REGION_SUFFIX.exec(siteId);
  return match ? match[0].slice(1) : undefined;
}
