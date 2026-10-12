/**
 * Request-Scoped Umbraco Version Tests
 *
 * The carrier exists because one Worker isolate serves many sites, each on
 * its own Umbraco version, with interleaved requests. So the tests that matter
 * most are about *isolation* — two interleaved calls on either side of a
 * version gate each see their own version — and about *absence* — no version
 * means "oldest", never a guess.
 */

import { describe, it, expect } from "@jest/globals";
import {
  UMBRACO_VERSION_CONTEXT_KEY,
  getUmbracoVersion,
  withRequestUmbracoVersion,
  isAtLeast,
} from "../request-context.js";

describe("getUmbracoVersion", () => {
  it("returns the raw version string a host attached", () => {
    expect(getUmbracoVersion({ [UMBRACO_VERSION_CONTEXT_KEY]: "17.6.0-rc.1" })).toBe("17.6.0-rc.1");
  });

  it("returns undefined when nothing was attached", () => {
    expect(getUmbracoVersion({})).toBeUndefined();
    expect(getUmbracoVersion({ [UMBRACO_VERSION_CONTEXT_KEY]: "" })).toBeUndefined();
    expect(getUmbracoVersion({ [UMBRACO_VERSION_CONTEXT_KEY]: 17 })).toBeUndefined();
  });

  it("never throws on a non-object context", () => {
    for (const context of [undefined, null, 0, "17.6.0", true, Symbol("x")]) {
      expect(() => getUmbracoVersion(context)).not.toThrow();
      expect(getUmbracoVersion(context)).toBeUndefined();
    }
  });
});

describe("withRequestUmbracoVersion", () => {
  it("attaches the version to the extra argument of a two-argument call", async () => {
    const seen: unknown[] = [];
    const wrapped = withRequestUmbracoVersion(async (_args: unknown, extra: unknown) => {
      seen.push(extra);
    }, "17.6.1");

    await wrapped({ id: 1 }, { sessionId: "sess-1" });

    expect(getUmbracoVersion(seen[0])).toBe("17.6.1");
    // The transport's own fields survive the copy.
    expect((seen[0] as { sessionId: string }).sessionId).toBe("sess-1");
  });

  it("attaches to the sole argument when the tool declares no input schema", async () => {
    const seen: unknown[] = [];
    const wrapped = withRequestUmbracoVersion(async (extra: unknown) => {
      seen.push(extra);
    }, "17.6.1");

    await wrapped({ sessionId: "sess-1" });

    expect(getUmbracoVersion(seen[0])).toBe("17.6.1");
  });

  it("does not mutate the object the MCP SDK owns", async () => {
    const extra = { sessionId: "sess-1" };
    const wrapped = withRequestUmbracoVersion(async (_args: unknown, _extra: unknown) => {}, "17.6.1");

    await wrapped({}, extra);

    expect(extra).not.toHaveProperty(UMBRACO_VERSION_CONTEXT_KEY);
  });

  it("returns the callback untouched when there is no version", () => {
    const callback = async () => {};
    expect(withRequestUmbracoVersion(callback, undefined)).toBe(callback);
    expect(withRequestUmbracoVersion(callback, "")).toBe(callback);
  });

  it("keeps two interleaved calls on either side of a gate isolated", async () => {
    // Two sites served by one isolate: 17.5 must not see 17.6's tools and
    // vice versa, even when their calls are in flight at the same time.
    let releaseOld!: () => void;
    const oldBlocked = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });

    const handler = async (args: { blockFirst: boolean }, extra: unknown) => {
      if (args.blockFirst) {
        await oldBlocked;
      }
      const version = getUmbracoVersion(extra);
      return { version, gated: isAtLeast(version, 17, 6) };
    };

    const forOldSite = withRequestUmbracoVersion(handler, "17.5.2");
    const forNewSite = withRequestUmbracoVersion(handler, "17.6.0");

    const oldCall = forOldSite({ blockFirst: true }, {});
    const newResult = await forNewSite({ blockFirst: false }, {});
    releaseOld();
    const oldResult = await oldCall;

    expect(newResult).toEqual({ version: "17.6.0", gated: true });
    expect(oldResult).toEqual({ version: "17.5.2", gated: false });
  });
});

describe("isAtLeast", () => {
  it("returns false for an undefined or unparsable version", () => {
    expect(isAtLeast(undefined, 17, 6)).toBe(false);
    expect(isAtLeast("", 17, 6)).toBe(false);
    expect(isAtLeast("Latest", 17, 6)).toBe(false);
    expect(isAtLeast("17", 17, 0)).toBe(false);
    expect(isAtLeast("seventeen.six", 17, 6)).toBe(false);
  });

  it("compares major then minor", () => {
    expect(isAtLeast("17.6.0", 17, 6)).toBe(true);
    expect(isAtLeast("17.6.3", 17, 6)).toBe(true);
    expect(isAtLeast("17.7.0", 17, 6)).toBe(true);
    expect(isAtLeast("18.0.0", 17, 6)).toBe(true);
    expect(isAtLeast("17.5.9", 17, 6)).toBe(false);
    expect(isAtLeast("16.9.0", 17, 6)).toBe(false);
    expect(isAtLeast("17.10.0", 17, 6)).toBe(true);
  });

  it("counts a prerelease as that version", () => {
    expect(isAtLeast("17.6.0-rc.1", 17, 6)).toBe(true);
    expect(isAtLeast("17.6.0-beta", 17, 6)).toBe(true);
    expect(isAtLeast("17.5.0-rc.1", 17, 6)).toBe(false);
  });

  it("ignores build metadata and surrounding whitespace", () => {
    expect(isAtLeast(" 17.6.0+build.5 ", 17, 6)).toBe(true);
    expect(isAtLeast("17.6", 17, 6)).toBe(true);
  });
});
