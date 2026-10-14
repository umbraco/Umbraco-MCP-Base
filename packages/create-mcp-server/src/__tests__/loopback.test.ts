import { describe, it, expect } from "@jest/globals";
import { isLoopbackUrl } from "../loopback.js";

describe("isLoopbackUrl", () => {
  it.each([
    ["https://localhost:44391", true],
    ["https://127.0.0.1:44391", true],
    ["https://[::1]:44391", true],
    ["https://localhost.example.com", false],
    ["https://my-127.0.0.1.example.com", false],
    ["https://example.com/localhost", false],
    ["not a url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isLoopbackUrl(url)).toBe(expected);
  });
});
