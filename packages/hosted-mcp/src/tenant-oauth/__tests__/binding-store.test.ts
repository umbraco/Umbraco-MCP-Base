import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  putClientBinding,
  hasClientBinding,
  getClientTenant,
  revokeClient,
  BINDING_TTL_SECONDS,
} from "../binding-store.js";

function createMockKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    put: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

describe("binding-store", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  describe("putClientBinding", () => {
    it("writes both forward and reverse keys", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(kv.store.has("at:tenant-a:client:client-123")).toBe(true);
      expect(kv.store.get("client:client-123:tenant")).toBe("tenant-a");
    });

    it("forward record contains a creation timestamp", async () => {
      const before = Date.now();
      await putClientBinding(kv as any, "tenant-a", "client-123");
      const fwd = JSON.parse(kv.store.get("at:tenant-a:client:client-123")!);
      expect(fwd.createdAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("hasClientBinding", () => {
    it("returns true when forward key exists", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(await hasClientBinding(kv as any, "tenant-a", "client-123")).toBe(true);
    });

    it("returns false when client is bound to a different tenant", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(await hasClientBinding(kv as any, "tenant-b", "client-123")).toBe(false);
    });

    it("returns false for unknown client_id", async () => {
      expect(await hasClientBinding(kv as any, "tenant-a", "unknown")).toBe(false);
    });
  });

  describe("getClientTenant", () => {
    it("returns the alias the client is bound to", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      expect(await getClientTenant(kv as any, "client-123")).toBe("tenant-a");
    });

    it("returns null for unbound client", async () => {
      expect(await getClientTenant(kv as any, "unbound")).toBeNull();
    });
  });

  describe("revokeClient", () => {
    it("removes both forward and reverse keys", async () => {
      await putClientBinding(kv as any, "tenant-a", "client-123");
      await revokeClient(kv as any, "client-123");
      expect(kv.store.has("at:tenant-a:client:client-123")).toBe(false);
      expect(kv.store.has("client:client-123:tenant")).toBe(false);
    });

    it("is a no-op when client is not bound", async () => {
      await expect(revokeClient(kv as any, "unknown")).resolves.toBeUndefined();
    });
  });

  describe("isolation", () => {
    it("binding for tenant A does not leak to tenant B", async () => {
      await putClientBinding(kv as any, "a", "shared-id");
      expect(await hasClientBinding(kv as any, "a", "shared-id")).toBe(true);
      expect(await hasClientBinding(kv as any, "b", "shared-id")).toBe(false);
    });
  });
});

describe("binding-store expiry", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function createKV() {
    const store = new Map<string, string>();
    return {
      store,
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      put: jest.fn(async (key: string, value: string, _options?: { expirationTtl?: number }) => {
        store.set(key, value);
      }),
      delete: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    };
  }

  it("writes both keys with the binding TTL", async () => {
    const kv = createKV();
    await putClientBinding(kv as any, "tenant-a", "client-123");

    expect(kv.put).toHaveBeenCalledTimes(2);
    for (const call of kv.put.mock.calls) {
      expect(call[2]).toEqual({ expirationTtl: BINDING_TTL_SECONDS });
    }
  });

  it("leaves a recent binding alone when it is used", async () => {
    const kv = createKV();
    await putClientBinding(kv as any, "tenant-a", "client-123");
    kv.put.mockClear();

    expect(await hasClientBinding(kv as any, "tenant-a", "client-123")).toBe(true);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("renews both keys when a binding older than 30 days is used", async () => {
    const kv = createKV();
    kv.store.set(
      "at:tenant-a:client:client-123",
      JSON.stringify({ createdAt: Date.now() - 31 * DAY_MS })
    );
    kv.store.set("client:client-123:tenant", "tenant-a");

    expect(await hasClientBinding(kv as any, "tenant-a", "client-123")).toBe(true);

    expect(kv.put.mock.calls.map((call) => call[0]).sort()).toEqual([
      "at:tenant-a:client:client-123",
      "client:client-123:tenant",
    ]);
    for (const call of kv.put.mock.calls) {
      expect(call[2]).toEqual({ expirationTtl: BINDING_TTL_SECONDS });
    }
  });

  it("still reports the binding when renewing it fails", async () => {
    const kv = createKV();
    kv.store.set(
      "at:tenant-a:client:client-123",
      JSON.stringify({ createdAt: Date.now() - 31 * DAY_MS })
    );
    kv.put.mockRejectedValue(new Error("KV unavailable"));

    expect(await hasClientBinding(kv as any, "tenant-a", "client-123")).toBe(true);
  });

  it("does not create a binding for a client that has none", async () => {
    const kv = createKV();
    expect(await hasClientBinding(kv as any, "tenant-a", "client-123")).toBe(false);
    expect(kv.put).not.toHaveBeenCalled();
  });
});
