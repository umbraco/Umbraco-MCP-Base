import { describe, expect, it, afterEach } from "@jest/globals";
import {
  clearConfirmationTokens,
  confirmationTokenStoreSize,
  consumeConfirmationToken,
  issueConfirmationToken,
  setConfirmationTokenTtlMs,
} from "../confirmation-tokens.js";

describe("widgets/confirmation-tokens", () => {
  afterEach(() => {
    clearConfirmationTokens();
    setConfirmationTokenTtlMs();
  });

  it("issues unique tokens", () => {
    const a = issueConfirmationToken({ id: "x" });
    const b = issueConfirmationToken({ id: "x" });
    expect(a).not.toBe(b);
  });

  it("consumes a valid token bound to the same args", () => {
    const token = issueConfirmationToken({ id: "x" });
    expect(consumeConfirmationToken(token, { id: "x" })).toBe(true);
  });

  it("treats a token as one-shot — second consume fails", () => {
    const token = issueConfirmationToken({ id: "x" });
    expect(consumeConfirmationToken(token, { id: "x" })).toBe(true);
    expect(consumeConfirmationToken(token, { id: "x" })).toBe(false);
  });

  it("rejects a token used with different args (args binding)", () => {
    const token = issueConfirmationToken({ id: "x" });
    expect(consumeConfirmationToken(token, { id: "y" })).toBe(false);
  });

  it("matches across argument-key reorderings", () => {
    const token = issueConfirmationToken({ id: "x", scope: "a" });
    expect(
      consumeConfirmationToken(token, { scope: "a", id: "x" }),
    ).toBe(true);
  });

  it("ignores undefined-valued keys when comparing", () => {
    const token = issueConfirmationToken({ id: "x" });
    expect(
      consumeConfirmationToken(token, { id: "x", optional: undefined }),
    ).toBe(true);
  });

  it("rejects an unknown token", () => {
    expect(consumeConfirmationToken("not-a-real-token", { id: "x" })).toBe(
      false,
    );
  });

  it("rejects a non-string token", () => {
    expect(consumeConfirmationToken(undefined, { id: "x" })).toBe(false);
    expect(consumeConfirmationToken(123, { id: "x" })).toBe(false);
    expect(consumeConfirmationToken("", { id: "x" })).toBe(false);
  });

  it("expires tokens after the configured TTL", async () => {
    setConfirmationTokenTtlMs(1);
    const token = issueConfirmationToken({ id: "x" });
    await new Promise((r) => setTimeout(r, 5));
    expect(consumeConfirmationToken(token, { id: "x" })).toBe(false);
  });

  it("evicts expired tokens from the store", async () => {
    setConfirmationTokenTtlMs(1);
    issueConfirmationToken({ id: "x" });
    issueConfirmationToken({ id: "y" });
    expect(confirmationTokenStoreSize()).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 5));
    expect(confirmationTokenStoreSize()).toBe(0);
  });
});
