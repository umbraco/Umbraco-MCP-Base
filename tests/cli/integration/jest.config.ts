import type { Config } from "jest";

/**
 * Jest configuration for CLI integration tests
 *
 * Tests CLI introspection, filtering, dry-run, and input sanitization
 * by running the built template binary end-to-end.
 *
 * Requires: npm run build -w packages/mcp-server-sdk && npm run build -w template
 */
const config: Config = {
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  rootDir: "..",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  testMatch: ["<rootDir>/integration/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  maxConcurrency: 1,
  maxWorkers: 1,
  testTimeout: 30000,
};

export default config;
