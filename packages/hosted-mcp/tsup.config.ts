import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [
    "@cloudflare/agents",
    "@cloudflare/workers-oauth-provider",
    "@modelcontextprotocol/sdk",
    "@umbraco-cms/mcp-server-sdk",
  ],
});
