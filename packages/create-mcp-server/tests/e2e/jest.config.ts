import type { Config } from "jest";

const config: Config = {
  displayName: "create-mcp-server-e2e",
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  setupFiles: ["./jest-setup.ts"],
  testMatch: ["**/tests/e2e/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  testTimeout: 600_000, // 10 minutes — PSW + dotnet run can be slow
};

export default config;
