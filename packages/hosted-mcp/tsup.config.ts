import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/testing/index.ts", "src/cloud/index.ts"],
  format: ["esm"],
  dts: {
    compilerOptions: {
      types: ["@cloudflare/workers-types", "@types/jest", "node"],
    },
  },
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [
    "@cloudflare/agents",
    "@cloudflare/workers-oauth-provider",
    "@modelcontextprotocol/sdk",
    "@umbraco-cms/mcp-server-sdk",
    "@playwright/test",
  ],
});
