import type { Config } from "jest";

/**
 * Jest configuration for CLI integration tests
 *
 * Separate config for tests that exercise the built CLI binary end-to-end
 * via MCP protocol. Requires `npm run build` before running.
 */
const config: Config = {
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  rootDir: "../..",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  testMatch: ["<rootDir>/tests/cli/__tests__/**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  // CLI integration test settings
  maxConcurrency: 1,
  maxWorkers: 1,
  testTimeout: 30000, // 30 second timeout for spawning processes
};

export default config;
