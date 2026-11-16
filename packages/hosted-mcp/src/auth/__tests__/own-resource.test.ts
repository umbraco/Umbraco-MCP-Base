import { describe, it, expect } from "@jest/globals";
import { dropOwnOriginResource, grantResource, resourceIsOnOrigin } from "../own-resource.js";

const ORIGIN = "https://worker.example.com";

describe("resourceIsOnOrigin", () => {
  it.each([
    [undefined],
    [""],
    [`${ORIGIN}`],
    [`${ORIGIN}/mcp`],
    [[`${ORIGIN}/mcp`, `${ORIGIN}/`]],
  ])("accepts %p", (resource) => {
    expect(resourceIsOnOrigin(resource as never, ORIGIN)).toBe(true);
  });

  it.each([
    ["https://other.example.com/mcp"],
    ["http://worker.example.com/mcp"],
    ["https://worker.example.com.evil.example/mcp"],
    ["/mcp"],
    ["not a url"],
    [[`${ORIGIN}/mcp`, "https://other.example.com/mcp"]],
  ])("refuses %p", (resource) => {
    expect(resourceIsOnOrigin(resource as never, ORIGIN)).toBe(false);
  });
});

describe("grantResource", () => {
  it("defaults to the origin when the client sent none", () => {
    expect(grantResource(undefined, ORIGIN)).toBe(ORIGIN);
    expect(grantResource([], ORIGIN)).toBe(ORIGIN);
  });

  it("keeps what the client sent", () => {
    expect(grantResource(`${ORIGIN}/mcp`, ORIGIN)).toBe(`${ORIGIN}/mcp`);
  });
});

describe("dropOwnOriginResource", () => {
  function tokenRequest(form: URLSearchParams): Request {
    return new Request(`${ORIGIN}/token`, {
      method: "POST",
      body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", Authorization: "Basic abc" },
    });
  }

  async function formOf(request: Request): Promise<URLSearchParams> {
    return new URLSearchParams(await request.text());
  }

  it("removes a resource on this origin and keeps everything else", async () => {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: "abc",
      client_id: "client-1",
      resource: `${ORIGIN}/mcp`,
    });

    const result = await dropOwnOriginResource(tokenRequest(form));

    const sent = await formOf(result);
    expect(sent.has("resource")).toBe(false);
    expect(sent.get("code")).toBe("abc");
    expect(sent.get("client_id")).toBe("client-1");
    expect(result.method).toBe("POST");
    expect(result.url).toBe(`${ORIGIN}/token`);
    expect(result.headers.get("Authorization")).toBe("Basic abc");
  });

  it("leaves a request without a resource untouched", async () => {
    const request = tokenRequest(new URLSearchParams({ grant_type: "refresh_token" }));
    expect(await dropOwnOriginResource(request)).toBe(request);
  });

  it("leaves a resource on another origin for the provider to refuse", async () => {
    const form = new URLSearchParams({ grant_type: "refresh_token" });
    form.append("resource", `${ORIGIN}/mcp`);
    form.append("resource", "https://other.example.com/mcp");
    const request = tokenRequest(form);

    const result = await dropOwnOriginResource(request);

    expect(result).toBe(request);
    expect((await formOf(result)).getAll("resource")).toHaveLength(2);
  });

  it("leaves non-form and non-POST requests untouched", async () => {
    const get = new Request(`${ORIGIN}/token?resource=${encodeURIComponent(ORIGIN)}`);
    expect(await dropOwnOriginResource(get)).toBe(get);

    const json = new Request(`${ORIGIN}/token`, {
      method: "POST",
      body: JSON.stringify({ resource: ORIGIN }),
      headers: { "content-type": "application/json" },
    });
    expect(await dropOwnOriginResource(json)).toBe(json);
  });
});
