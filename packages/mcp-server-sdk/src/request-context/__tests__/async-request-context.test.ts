import { describe, it, expect, jest, afterEach } from "@jest/globals";

const originalGetBuiltinModule = process.getBuiltinModule;

afterEach(() => {
  process.getBuiltinModule = originalGetBuiltinModule;
  jest.restoreAllMocks();
});

async function loadFresh() {
  let mod!: typeof import("../async-request-context.js");
  await jest.isolateModulesAsync(async () => {
    mod = await import("../async-request-context.js");
  });
  return mod;
}

describe("request context store availability", () => {
  it("reports the store available and carries values when async_hooks exists", async () => {
    const mod = await loadFresh();

    expect(mod.isRequestContextStoreAvailable()).toBe(true);
    const seen = mod.runWithRequestContext({ umbracoVersion: "17.6.0" }, () =>
      mod.getActiveRequestContext(),
    );
    expect(seen).toEqual({ umbracoVersion: "17.6.0" });
  });

  it("warns once, still runs fn, and reports unavailable when getBuiltinModule is gone", async () => {
    process.getBuiltinModule = undefined as unknown as typeof process.getBuiltinModule;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadFresh();

    expect(mod.isRequestContextStoreAvailable()).toBe(false);
    expect(mod.runWithRequestContext({ umbracoVersion: "17.6.0" }, () => "ran")).toBe("ran");
    expect(mod.runWithRequestContext({ umbracoVersion: "17.6.0" }, () => "again")).toBe("again");
    expect(mod.getActiveRequestContext()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
