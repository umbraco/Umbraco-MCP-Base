import { jest, describe, it, expect } from "@jest/globals";

const checkNodeVersion = jest.fn(() => null);

jest.unstable_mockModule("../../version-check/check-node-version.js", () => ({ checkNodeVersion }));

describe("Node.js version warning", () => {
  it("is checked when the stdio client is initialized", async () => {
    const { initializeUmbracoFetch } = await import("../umbraco-fetch-client.js");
    initializeUmbracoFetch({ baseUrl: "https://localhost:44391", clientId: "client", clientSecret: "secret" });
    expect(checkNodeVersion).toHaveBeenCalledTimes(1);
  });
});
