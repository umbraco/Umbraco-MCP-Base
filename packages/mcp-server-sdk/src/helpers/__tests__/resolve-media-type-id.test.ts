import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
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
// Loopback hosts: CI sets NODE_TLS_REJECT_UNAUTHORIZED=0, which the fetch client
// refuses for non-local base URLs. Different ports are still different sites.
const UPGRADED_SITE = "https://localhost:44301";
const OTHER_SITE = "https://127.0.0.1:44302";
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
  // Seeded name differs from the alias and from the old "SVG" name.
  { id: "55555555-5555-4555-8555-555555555555", name: "Vector Graphics (SVG)", alias: "umbracoMediaVectorGraphics" },
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

afterEach(() => {
  jest.restoreAllMocks();
});

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

  it("returns undefined when no media type has the alias, and caches the miss for a minute", async () => {
    const start = Date.now();
    const now = jest.spyOn(Date, "now").mockReturnValue(start);

    expect(await resolveMediaTypeId("doesNotExist")).toBeUndefined();
    const afterFirst = requests.length;
    expect(requests.some((r) => r.includes("/tree/media-type/root"))).toBe(true);

    // Within the minute: no second tree walk.
    now.mockReturnValue(start + 59_000);
    expect(await resolveMediaTypeId("doesNotExist")).toBeUndefined();
    expect(requests.length).toBe(afterFirst);

    // After it: looked up again, so a type created in the meantime is found.
    now.mockReturnValue(start + 61_000);
    expect(await resolveMediaTypeId("doesNotExist")).toBeUndefined();
    expect(requests.length).toBeGreaterThan(afterFirst);
  });

  it("searches for the seeded Vector Graphics name", async () => {
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.VectorGraphics)).toBe("55555555-5555-4555-8555-555555555555");
    const search = requests.find((r) => r.includes("/item/media-type/search"));
    expect(new URL(search!).searchParams.get("query")).toBe("Vector Graphics (SVG)");
    expect(requests.some((r) => r.includes("/tree/media-type/"))).toBe(false);
  });

  it("returns undefined instead of a 403 when the user can't read the media type tree", async () => {
    // Editors with Media access only: search and GET /media-type/{id} work, the tree doesn't.
    server.use(
      http.get(`${UPGRADED_SITE}${API}/tree/media-type/root`, () =>
        HttpResponse.json({ title: "Forbidden" }, { status: 403 })
      )
    );
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Video)).toBeUndefined();
    // The name search still resolves types it can find.
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).toBe("c5ed92a2-8233-35f0-963d-60c3caf1e7e1");
  });

  it("pages through a folder with more than 100 media types, even without a total", async () => {
    const folderId = "66666666-6666-4666-8666-666666666666";
    const bulk = Array.from({ length: 150 }, (_, i) => ({
      id: `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`,
      alias: i === 120 ? "deepType" : `bulk${i}`,
    }));
    server.use(
      http.get(`${UPGRADED_SITE}${API}/tree/media-type/root`, () =>
        HttpResponse.json({ total: 1, items: [{ id: folderId, isFolder: true, hasChildren: true }] })
      ),
      http.get(`${UPGRADED_SITE}${API}/tree/media-type/children`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        const skip = Number(params.get("skip"));
        const take = Number(params.get("take"));
        // No `total`: paging must continue until a short page.
        return HttpResponse.json({
          items: bulk.slice(skip, skip + take).map(({ id }) => ({ id, isFolder: false, hasChildren: false })),
        });
      }),
      http.get(`${UPGRADED_SITE}${API}/media-type/:id`, ({ params }) => {
        const type = bulk.find((t) => t.id === params.id);
        return HttpResponse.json({ id: params.id, alias: type?.alias ?? "" });
      })
    );
    expect(await resolveMediaTypeId("deepType")).toBe(bulk[120].id);
  });

  it("returns undefined to every concurrent caller on a miss", async () => {
    const results = await Promise.all([resolveMediaTypeId("doesNotExist"), resolveMediaTypeId("doesNotExist")]);
    expect(results).toEqual([undefined, undefined]);
  });

  it("does not cache a custom client's result under another site's key", async () => {
    // The module client points at the upgraded site; this client talks to the other one.
    const client = <T>(config: { url: string; params?: Record<string, unknown> }): Promise<T> => {
      const query = new URLSearchParams(
        Object.entries(config.params ?? {}).map(([k, v]) => [k, String(v)])
      ).toString();
      return fetch(`${OTHER_SITE}${config.url}${query ? `?${query}` : ""}`).then((r) => r.json() as Promise<T>);
    };
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder, { client })).toBe("44444444-4444-4444-8444-444444444444");
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)).toBe("c5ed92a2-8233-35f0-963d-60c3caf1e7e1");

    // With baseUrl the custom client's result is cached under that site.
    await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder, { client, baseUrl: OTHER_SITE });
    const before = requests.length;
    expect(await resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder, { client, baseUrl: `${OTHER_SITE}/` })).toBe(
      "44444444-4444-4444-8444-444444444444"
    );
    expect(requests.length).toBe(before);
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
