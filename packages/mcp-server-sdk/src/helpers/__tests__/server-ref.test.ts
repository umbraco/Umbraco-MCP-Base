import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { setServerRef, getServerRef, clearServerRef } from "../server-ref.js";

describe("server-ref", () => {
  afterEach(() => {
    clearServerRef();
  });

  it("should throw when server ref not set", () => {
    expect(() => getServerRef()).toThrow("Server reference not set");
  });

  it("should store and return server ref", () => {
    const mockServer = { elicitInput: jest.fn() } as any;
    setServerRef(mockServer);
    expect(getServerRef()).toBe(mockServer);
  });

  it("should clear server ref", () => {
    const mockServer = { elicitInput: jest.fn() } as any;
    setServerRef(mockServer);
    clearServerRef();
    expect(() => getServerRef()).toThrow("Server reference not set");
  });

  it("should allow overwriting server ref", () => {
    const server1 = { id: 1 } as any;
    const server2 = { id: 2 } as any;
    setServerRef(server1);
    setServerRef(server2);
    expect(getServerRef()).toBe(server2);
  });
});
