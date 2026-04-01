import type { Config } from "jest";

/**
 * Jest configuration for CLI eval tests
 *
 * LLM-driven tests that verify an agent can use the mcp-cli skill
 * to run and interpret CLI commands.
 *
 * Requires: npm run build -w packages/mcp-server-sdk && npm run build -w template
 * Requires: ANTHROPIC_API_KEY or Claude Code subscription
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
  setupFiles: ["<rootDir>/evals/jest-setup.ts"],
  testMatch: ["<rootDir>/evals/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  maxConcurrency: 1,
  maxWorkers: 1,
  testTimeout: 120000,
  slowTestThreshold: 300,
};

export default config;
