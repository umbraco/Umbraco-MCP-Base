import type { JestConfigWithTsJest } from "ts-jest";

const config: JestConfigWithTsJest = {
  displayName: "hosted-mcp",
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@umbraco-cms/mcp-server-sdk$": "<rootDir>/../../node_modules/@umbraco-cms/mcp-server-sdk/dist/index.js",
    "^@modelcontextprotocol/sdk/(.*)\\.js$": "<rootDir>/../../node_modules/@modelcontextprotocol/sdk/dist/esm/$1.js",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(@modelcontextprotocol|@umbraco-cms)/)",
  ],
  testMatch: ["**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
};

export default config;
