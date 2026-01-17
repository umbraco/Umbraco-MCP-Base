import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/testing/index.ts",
    "src/evals/index.ts",
    "src/config/index.ts",
    "src/helpers/index.ts",
    "src/types/index.ts",
    "src/constants/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    "@anthropic-ai/claude-agent-sdk",
    "@jest/globals",
    "dotenv",
    "yargs",
    "yargs/helpers",
  ],
});
