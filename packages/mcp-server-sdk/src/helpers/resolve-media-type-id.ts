/**
 * Media Type Id Resolver
 *
 * Resolves a media type's id on the connected Umbraco site from its alias.
 *
 * The fresh-install keys in `constants.ts` (`FOLDER_MEDIA_TYPE_ID`, …) are not
 * universal: sites upgraded from older Umbraco versions carry different keys
 * for the same built-in media types, so posting a hard-coded key to such a
 * site fails with a 404 (umbraco/Umbraco-MCP-Base#448). Aliases (`Folder`,
 * `Image`, `File`, `umbracoMediaVideo`, …) are stable across installs, so this
 * helper looks the id up by alias via the Management API and caches it per
 * base URL.
 */

import { UmbracoManagementClient, getUmbracoFetchBaseUrl } from "../http/umbraco-fetch-client.js";
import { getActiveRequestContext } from "../request-context/async-request-context.js";
import { MEDIA_TYPE_ALIASES } from "../constants/constants.js";
import { normalizeBaseUrl } from "./url.js";

const API = "/umbraco/management/api/v1";
const PAGE_SIZE = 100;

/** Request function with the Orval mutator signature (e.g. `UmbracoManagementClient`). */
export type MediaTypeResolverClient = <T>(
  config: { url: string; method: string; params?: Record<string, unknown> },
  options?: Record<string, unknown>
) => Promise<T>;

/** Options for {@link resolveMediaTypeId}. */
export interface ResolveMediaTypeIdOptions {
  /**
   * Name to search for before falling back to walking the media type tree.
   * The Management API search matches names, not aliases. Defaults to the
   * built-in name for a `MEDIA_TYPE_ALIASES` entry, otherwise the alias.
   */
  searchName?: string;
  /**
   * Cache key: the Umbraco base URL the request goes to. Defaults to the
   * hosted session's base URL, then the one passed to
   * `initializeUmbracoFetch()`. When none is known the result is not cached.
   */
  baseUrl?: string;
  /**
   * Request function to use. Defaults to `UmbracoManagementClient`, which
   * honours the hosted session transport and `setCustomTransport()`.
   * A custom client's results are only cached when `baseUrl` is also given,
   * since the resolver can't tell which site the client talks to.
   */
  client?: MediaTypeResolverClient;
}

interface ItemsPage<T> {
  total?: number;
  items?: T[];
}

interface MediaTypeTreeItem {
  id: string;
  isFolder?: boolean;
  hasChildren?: boolean;
}

/** Built-in names, used as the search term for the well-known aliases. */
const BUILT_IN_NAMES: Record<string, string> = {
  [MEDIA_TYPE_ALIASES.Folder]: "Folder",
  [MEDIA_TYPE_ALIASES.Image]: "Image",
  [MEDIA_TYPE_ALIASES.File]: "File",
  [MEDIA_TYPE_ALIASES.Video]: "Video",
  [MEDIA_TYPE_ALIASES.Audio]: "Audio",
  [MEDIA_TYPE_ALIASES.Article]: "Article",
  [MEDIA_TYPE_ALIASES.VectorGraphics]: "Vector Graphics (SVG)",
};

/**
 * How long a miss stays cached. Long enough that a burst of tool calls for an
 * alias the site lacks doesn't walk the whole media type tree each time,
 * short enough that a media type created later is soon found.
 */
const MISS_TTL_MS = 60_000;

interface CacheEntry {
  pending: Promise<string | undefined>;
  /** Set once the lookup settles as a miss; the entry is ignored after this time. */
  expiresAt?: number;
}

/** base URL → alias → pending, found or recently missed lookup. */
const cache = new Map<string, Map<string, CacheEntry>>();

/**
 * Clears the per-base-URL cache used by {@link resolveMediaTypeId}. Useful in
 * tests, or after media types were recreated on a site.
 */
export function clearMediaTypeIdCache(): void {
  cache.clear();
}

/**
 * Resolves the id of the media type with the given alias on the connected
 * Umbraco site. Use it instead of the fresh-install-only `*_MEDIA_TYPE_ID`
 * constants:
 *
 * ```typescript
 * import { resolveMediaTypeId, MEDIA_TYPE_ALIASES } from "@umbraco-cms/mcp-server-sdk";
 *
 * const folderTypeId = await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder);
 * if (!folderTypeId) throw new Error("No Folder media type on this site");
 * ```
 *
 * Lookup (alias match is exact):
 * 1. `GET /item/media-type/search?query=<name>` for candidates (the search
 *    matches names), then `GET /media-type/{id}` on each to compare aliases.
 * 2. If that finds nothing, walks `GET /tree/media-type/root` and
 *    `/tree/media-type/children` and checks every media type the same way.
 *
 * Found ids are cached per base URL, so each site is asked once per alias.
 * Misses are cached for a minute, so repeated calls for an alias the site
 * lacks don't each walk the tree; a media type created later is found once
 * that expires (or after `clearMediaTypeIdCache()`). Errors are not cached.
 *
 * The tree walk needs access to the Settings section's media type tree.
 * Users without it (e.g. editors with Media access only) still get the name
 * search; if that finds nothing, the walk's 403 is treated as "not found".
 *
 * @param alias - Media type alias, e.g. `MEDIA_TYPE_ALIASES.Folder`
 * @returns The media type id, or `undefined` when the site has no media type with that alias
 * @throws When a Management API request fails
 */
export async function resolveMediaTypeId(
  alias: string,
  options: ResolveMediaTypeIdOptions = {}
): Promise<string | undefined> {
  const client = options.client ?? (UmbracoManagementClient as MediaTypeResolverClient);
  // A caller-supplied client may target any site, so only cache its results
  // when the caller says which site that is.
  const baseUrl =
    options.client && !options.baseUrl ? undefined : await resolveCacheKey(options.baseUrl);

  const lookup = () => findMediaTypeId(client, alias, options.searchName ?? BUILT_IN_NAMES[alias] ?? alias);

  if (baseUrl === undefined) {
    return lookup();
  }

  let site = cache.get(baseUrl);
  if (!site) {
    site = new Map();
    cache.set(baseUrl, site);
  }
  const cached = site.get(alias);
  if (cached && (cached.expiresAt === undefined || cached.expiresAt > Date.now())) {
    return cached.pending;
  }

  const siteCache = site;
  const entry: CacheEntry = { pending: lookup() };
  siteCache.set(alias, entry);
  entry.pending.then(
    (id) => {
      if (id === undefined) entry.expiresAt = Date.now() + MISS_TTL_MS;
    },
    // Drop errors from the cache so the next call retries.
    () => {
      if (siteCache.get(alias) === entry) siteCache.delete(alias);
    }
  );
  return entry.pending;
}

function isForbidden(error: unknown): boolean {
  return (error as { response?: { status?: number } } | undefined)?.response?.status === 403;
}

async function resolveCacheKey(explicit: string | undefined): Promise<string | undefined> {
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }
  const sessionAuth = getActiveRequestContext()?.umbracoAuth;
  if (sessionAuth) {
    return normalizeBaseUrl((await sessionAuth()).baseUrl);
  }
  return getUmbracoFetchBaseUrl();
}

async function findMediaTypeId(
  client: MediaTypeResolverClient,
  alias: string,
  searchName: string
): Promise<string | undefined> {
  const checked = new Set<string>();

  const matches = async (id: string): Promise<boolean> => {
    if (checked.has(id)) return false;
    checked.add(id);
    const mediaType = await client<{ alias?: string }>({
      url: `${API}/media-type/${encodeURIComponent(id)}`,
      method: "GET",
    });
    return mediaType?.alias === alias;
  };

  // 1. Name search: one request plus one per candidate in the common case.
  const searchResults = await client<ItemsPage<{ id: string }>>({
    url: `${API}/item/media-type/search`,
    method: "GET",
    params: { query: searchName, skip: 0, take: PAGE_SIZE },
  });
  for (const item of searchResults?.items ?? []) {
    if (await matches(item.id)) return item.id;
  }

  // 2. Fallback for renamed types: walk the whole media type tree. The tree
  // needs Settings access, so a user without it gets "not found" rather than
  // a 403 for an alias the site may simply not have.
  try {
    return await walkTree(client, matches);
  } catch (error) {
    if (isForbidden(error)) return undefined;
    throw error;
  }
}

async function walkTree(
  client: MediaTypeResolverClient,
  matches: (id: string) => Promise<boolean>
): Promise<string | undefined> {
  const parents: Array<string | undefined> = [undefined];
  while (parents.length > 0) {
    const parentId = parents.shift();
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await client<ItemsPage<MediaTypeTreeItem>>({
        url: parentId === undefined ? `${API}/tree/media-type/root` : `${API}/tree/media-type/children`,
        method: "GET",
        params: { ...(parentId === undefined ? {} : { parentId }), skip, take: PAGE_SIZE, foldersOnly: false },
      });
      const items = page?.items ?? [];
      for (const item of items) {
        if (item.hasChildren) parents.push(item.id);
        if (!item.isFolder && (await matches(item.id))) return item.id;
      }
      // A short page is the last one; `total` (when present) can end it sooner.
      if (items.length < PAGE_SIZE || (page?.total !== undefined && skip + items.length >= page.total)) break;
    }
  }

  return undefined;
}
