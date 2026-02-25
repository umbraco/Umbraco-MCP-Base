import type { Config } from "jest";

/**
 * Jest configuration for eval tests
 *
 * This config is separate from the main jest config and customizes settings
 * for long-running eval tests:
 * - Higher timeout (120s)
 * - Disabled slow test warnings
 * - Silent mode for clean output (controlled by scenario-runner)
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
  testMatch: ["<rootDir>/tests/evals/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/evals/helpers/e2e-setup.ts"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  // Eval specific settings
  maxConcurrency: 1,
  maxWorkers: 1,
  testTimeout: 120000, // 2 minute timeout for long-running tests

  // Disable slow test warnings (these are expected to be slow)
  slowTestThreshold: 300, // 5 minutes - effectively disables the warning
};

export default config;
