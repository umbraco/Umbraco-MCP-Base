import type { Config } from "jest";

// Allow self-signed certificates for local Umbraco dev instances
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const config: Config = {
  displayName: "hosted-chained-mcp-integration",
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  rootDir: ".",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/../tsconfig.json",
      },
    ],
  },
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  maxWorkers: 1,
  testTimeout: 60000,
};

export default config;
