import type { Config } from "jest";

/**
 * Jest configuration for SDK-level eval tests
 *
 * These evals test how an LLM agent interacts with CLI safety features
 * (input sanitization, dry-run mode, error handling). Uses the template
 * as a built test harness.
 *
 * Requires: npm run build && cd template && npx tsup
 * Requires: ANTHROPIC_API_KEY or Claude Code subscription
 */
const config: Config = {
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
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  testMatch: ["<rootDir>/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/runtime-setup.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  maxConcurrency: 1,
  maxWorkers: 1,
  testTimeout: 120000,
  slowTestThreshold: 300,
};

export default config;
