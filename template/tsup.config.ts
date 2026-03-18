import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/collections.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  treeshake: true,
  minify: false,
  dts: false,
});
