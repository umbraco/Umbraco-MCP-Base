const config: import("ts-jest").JestConfigWithTsJest = {
  preset: "ts-jest/presets/js-with-ts-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
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
  setupFilesAfterEnv: ["<rootDir>/src/mocks/jest-setup.ts"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__evals__/**/*.eval.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageDirectory: "coverage",
  verbose: true,
  // Force exit after tests complete - needed for eval tests which spawn subprocesses
  forceExit: true,
};

module.exports = config;
