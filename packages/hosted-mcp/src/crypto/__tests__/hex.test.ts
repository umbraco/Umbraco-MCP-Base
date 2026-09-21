import { describe, it, expect } from "@jest/globals";
import { toHex } from "../hex.js";

describe("toHex", () => {
  it("lower-case hex-encodes bytes with no separators", () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("returns an empty string for an empty byte sequence", () => {
    expect(toHex(new Uint8Array([]))).toBe("");
  });
});
