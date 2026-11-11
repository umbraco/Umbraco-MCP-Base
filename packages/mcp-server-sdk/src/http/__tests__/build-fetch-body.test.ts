import { describe, it, expect } from "@jest/globals";
import { EventEmitter } from "node:events";
import { buildFetchBody } from "../umbraco-fetch-client.js";

// Shared by the singleton and factory fetch clients (#446).

// Minimal stand-in for the `form-data` package: getHeaders()/pipe() mark it as
// stream FormData, and resume() emits the body the helper collects.
function streamFormData() {
  const fd = Object.assign(new EventEmitter(), {
    getHeaders: () => ({ "content-type": "multipart/form-data; boundary=x" }),
    pipe: () => fd,
    resume: () => {
      fd.emit("data", "--x\r\n");
      fd.emit("data", Buffer.from("body\r\n--x--\r\n"));
      fd.emit("end");
    },
  });
  return fd;
}

describe("buildFetchBody", () => {
  it("stringifies a JSON object and keeps the default Content-Type", async () => {
    const result = await buildFetchBody({ a: 1, b: ["x"] });
    expect(result).toEqual({ body: '{"a":1,"b":["x"]}', skipDefaultContentType: false });
  });

  it("stringifies primitives and null as JSON", async () => {
    expect((await buildFetchBody("hi")).body).toBe('"hi"');
    expect((await buildFetchBody(null)).body).toBe("null");
    expect((await buildFetchBody(null)).skipDefaultContentType).toBe(false);
  });

  it("passes Web FormData through and skips the default Content-Type", async () => {
    const fd = new FormData();
    fd.append("name", "value");
    const result = await buildFetchBody(fd);
    expect(result.body).toBe(fd);
    expect(result.skipDefaultContentType).toBe(true);
  });

  it("collects stream FormData into a Uint8Array and skips the default Content-Type", async () => {
    const result = await buildFetchBody(streamFormData());
    expect(result.skipDefaultContentType).toBe(true);
    expect(result.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(result.body as unknown as Uint8Array).toString("utf8"))
      .toBe("--x\r\nbody\r\n--x--\r\n");
  });

  it("rejects when the stream FormData errors", async () => {
    const fd = streamFormData();
    fd.resume = () => { fd.emit("error", new Error("boom")); };
    await expect(buildFetchBody(fd)).rejects.toThrow("boom");
  });

  it("returns no body for undefined data", async () => {
    const result = await buildFetchBody(undefined);
    expect(result.body).toBeUndefined();
    expect(result.skipDefaultContentType).toBe(false);
  });
});
