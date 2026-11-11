import { describe, it, expect, beforeEach } from "@jest/globals";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { setupMswServer } from "../../testing/test-environment.js";
import { initializeUmbracoFetch } from "../../http/umbraco-fetch-client.js";
import { runWithRequestContext } from "../../request-context/async-request-context.js";
import {
  FILE_MEDIA_TYPE_ID,
  FOLDER_MEDIA_TYPE_ID,
  IMAGE_MEDIA_TYPE_ID,
  MEDIA_TYPE_ALIASES,
} from "../../constants/constants.js";
import { clearMediaTypeIdCache, resolveMediaTypeId } from "../resolve-media-type-id.js";

// Regression for #448: sites upgraded from older Umbraco versions carry
// different media type keys than a fresh install. These are the keys from the
// upgraded site in the issue.
const UPGRADED_SITE = "https://upgraded.example.test";
const OTHER_SITE = "https://other.example.test";
const API = "/umbraco/management/api/v1";

interface MediaType {
  id: string;
  name: string;
  alias: string;
  parentId?: string;
  isFolder?: boolean;
}

const UPGRADED_TYPES: MediaType[] = [
  { id: "c5ed92a2-8233-35f0-963d-60c3caf1e7e1", name: "Folder", alias: "Folder" },
  { id: "8dac1969-7e45-3dc1-a363-b3e203bab172", name: "Image", alias: "Image" },
  { id: "0de4a970-9ac2-350a-a5ad-3c6639ba86e2", name: "File", alias: "File" },
  // Shares a name fragment with "File" so the name search returns two candidates.
  { id: "11111111-1111-4111-8111-111111111111", name: "File Archive", alias: "fileArchive" },
  // Renamed built-in: the name search can't find it, only the tree walk can.
  { id: "22222222-2222-4222-8222-222222222222", name: "Movies", alias: "umbracoMediaVideo", parentId: "33333333-3333-4333-8333-333333333333" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Custom", alias: "", isFolder: true },
];

const OTHER_TYPES: MediaType[] = [
  { id: "44444444-4444-4444-8444-444444444444", name: "Folder", alias: "Folder" },
];

const requests: string[] = [];

function handlersFor(site: string, types: MediaType[]) {
  const log = (request: Request) => {
    const url = new URL(request.url);
    requests.push(`${url.origin}${url.pathname}${url.search}`);
  };
  const tree = (parentId: string | undefined) =>
    types
      .filter((t) => t.parentId === parentId)
      .map((t) => ({
        id: t.id,
        name: t.name,
        isFolder: !!t.isFolder,
        hasChildren: types.some((c) => c.parentId === t.id),
      }));
  return [
    http.post(`${site}${API}/security/back-office/token`, () =>
      HttpResponse.json({ access_token: "token", expires_in: 300 })
    ),
    http.get(`${site}${API}/item/media-type/search`, ({ request }) => {
      log(request);
      const query = new URL(request.url).searchParams.get("query") ?? "";
      const items = types
        .filter((t) => !t.isFolder && t.name.includes(query))
        .map(({ id, name }) => ({ id, name }));
      return HttpResponse.json({ total: items.length, items });
    }),
    http.get(`${site}${API}/media-type/:id`, ({ request, params }) => {
      log(request);
      const type = types.find((t) => t.id === params.id && !t.isFolder);
      return type
        ? HttpResponse.json({ id: type.id, name: type.name, alias: type.alias })
        : HttpResponse.json({ title: "Not found" }, { status: 404 });
    }),
    http.get(`${site}${API}/tree/media-type/root`, ({ request }) => {
      log(request);
      const items = tree(undefined);
      return HttpResponse.json({ total: items.length, items });
    }),
    http.get(`${site}${API}/tree/media-type/children`, ({ request }) => {
      log(request);
      const items = tree(new URL(request.url).searchParams.get("parentId") ?? undefined);
      return HttpResponse.json({ total: items.length, items });
    }),
  ];
}

const server = setupServer(...handlersFor(UPGRADED_SITE, UPGRADED_TYPES), ...handlersFor(OTHER_SITE, OTHER_TYPES));
setupMswServer(server);

beforeEach(() => {
  clearMediaTypeIdCache();
  requests.length = 0;
  initializeUmbracoFetch({ baseUrl: UPGRADED_SITE, clientId: "id", clientSecret: "secret" });
});

describe("resolveMediaTypeId", () => {
  it("returns the site's id, not the fresh-install constant, when keys differ", async () => {
    const folder = await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder);
    const image = await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Image);

    expect(folder).toBe("c5ed92a2-8233-35f0-963d-60c3caf1e7e1");
    expect(folder).not.toBe(FOLDER_MEDIA_TYPE_ID);
    expect(image).toBe("8dac1969-7e45-3dc1-a363-b3e203bab172");
    expect(image).not.toBe(IMAGE_MEDIA_TYPE_ID);
  });

  it("matches the alias exactly among several name-search candidates", async () => {
    const file = await resolveMediaTypeId(MEDIA_TYPE_ALIASES.File);

    expect(file).toBe("0de4a970-9ac2-350a-a5ad-3c6639ba86e2");
    expect(file).not.toBe(FILE_MEDIA_TYPE_ID);
    expect(await resolveMediaTypeId("fileArchive", { searchName: "File" })).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("falls back to walking the tree when the type was renamed", async () => {
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Video)).toBe("22222222-2222-4222-8222-222222222222");
    expect(requests.some((r) => r.includes("/tree/media-type/children"))).toBe(true);
  });

  it("caches the id per base URL", async () => {
    await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder);
    const afterFirst = requests.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Same site: served from cache, no further requests.
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).toBe("c5ed92a2-8233-35f0-963d-60c3caf1e7e1");
    expect(requests.length).toBe(afterFirst);

    // Another site: its own lookup and its own id.
    initializeUmbracoFetch({ baseUrl: OTHER_SITE, clientId: "id", clientSecret: "secret" });
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).toBe("44444444-4444-4444-8444-444444444444");
    expect(requests.slice(afterFirst).every((r) => r.startsWith(OTHER_SITE))).toBe(true);

    // Back on the first site: still cached.
    initializeUmbracoFetch({ baseUrl: `${UPGRADED_SITE}/`, clientId: "id", clientSecret: "secret" });
    const beforeReturn = requests.length;
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).toBe("c5ed92a2-8233-35f0-963d-60c3caf1e7e1");
    expect(requests.length).toBe(beforeReturn);
  });

  it("shares one lookup between concurrent callers", async () => {
    const [a, b] = await Promise.all([
      resolveMediaTypeId(MEDIA_TYPE_ALIASES.Image),
      resolveMediaTypeId(MEDIA_TYPE_ALIASES.Image),
    ]);
    expect(a).toBe(b);
    expect(requests.filter((r) => r.includes("/item/media-type/search")).length).toBe(1);
  });

  it("keys the cache on the hosted session's base URL", async () => {
    const session = { umbracoAuth: async () => ({ baseUrl: OTHER_SITE, accessToken: "t" }) };
    // The module client still points at the upgraded site; the cache key must
    // come from the session, so the two sites' results don't mix.
    const transport = (config: { url: string; params?: Record<string, unknown> }) => {
      const query = new URLSearchParams(
        Object.entries(config.params ?? {}).map(([k, v]) => [k, String(v)])
      ).toString();
      return fetch(`${OTHER_SITE}${config.url}${query ? `?${query}` : ""}`).then((r) => r.json());
    };
    const id = await runWithRequestContext({ ...session, transport }, () =>
      resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)
    );
    expect(id).toBe("44444444-4444-4444-8444-444444444444");

    // Outside the session the upgraded site resolves its own id.
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).toBe("c5ed92a2-8233-35f0-963d-60c3caf1e7e1");
  });

  it("returns undefined when no media type has the alias, and does not cache the miss", async () => {
    expect(await resolveMediaTypeId("doesNotExist")).toBeUndefined();
    const afterFirst = requests.length;

    expect(await resolveMediaTypeId("doesNotExist")).toBeUndefined();
    expect(requests.length).toBeGreaterThan(afterFirst);
  });

  it("propagates API errors without caching them", async () => {
    server.use(
      http.get(`${UPGRADED_SITE}${API}/item/media-type/search`, () =>
        HttpResponse.json({ title: "Boom" }, { status: 500 })
      )
    );
    await expect(resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).rejects.toThrow(/500/);

    server.resetHandlers();
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).toBe("c5ed92a2-8233-35f0-963d-60c3caf1e7e1");
  });
});
