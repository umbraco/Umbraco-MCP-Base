import { describe, it, expect } from "@jest/globals";
import { buildFetchBody } from "../umbraco-fetch-client.js";
import { streamFormData } from "./stream-form-data.js";

// Shared by the singleton and factory fetch clients (#446).

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

  it("collects stream FormData without the Node Buffer global (Workers)", async () => {
    const fd = streamFormData();
    fd.resume = () => {
      fd.emit("data", "--x\r\n");
      fd.emit("data", new TextEncoder().encode("body\r\n--x--\r\n"));
      fd.emit("end");
    };
    const { Buffer: originalBuffer } = globalThis;
    (globalThis as any).Buffer = undefined;
    try {
      const result = await buildFetchBody(fd);
      expect(new TextDecoder().decode(result.body as unknown as Uint8Array))
        .toBe("--x\r\nbody\r\n--x--\r\n");
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });

  it("rejects with the signal's reason when aborted while a stream never ends", async () => {
    const fd = streamFormData();
    fd.resume = () => {}; // e.g. already drained by an earlier attempt
    const controller = new AbortController();
    const pending = buildFetchBody(fd, controller.signal);
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
  });

  it("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await expect(buildFetchBody(streamFormData(), controller.signal)).rejects.toThrow("gone");
  });

  it("returns no body for undefined data", async () => {
    const result = await buildFetchBody(undefined);
    expect(result.body).toBeUndefined();
    expect(result.skipDefaultContentType).toBe(false);
  });
});
