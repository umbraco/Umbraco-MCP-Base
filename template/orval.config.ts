import { defineConfig, type HookFunction } from "orval";
import {
  orvalImportFixer,
  relaxUntypedArrays,
  postProcessZodFiles,
} from "@umbraco-cms/mcp-server-sdk";

/**
 * Orval Configuration
 *
 * This generates TypeScript API clients from OpenAPI specs.
 *
 * The template includes a sample OpenAPI spec (src/umbraco-api/api/openapi.yaml) that
 * demonstrates the patterns. Replace it with your add-on's spec.
 *
 * Example OpenAPI spec sources:
 * - Local file: "./src/umbraco-api/api/openapi.yaml"
 * - Local Umbraco 18+: "http://localhost:44391/umbraco/openapi/management.json"
 * - Local Umbraco 17:  "http://localhost:44391/umbraco/swagger/management/swagger.json"
 * - Remote URL: "https://api.example.com/openapi.json"
 *
 * Umbraco 18 emits OpenAPI 3.1; this config uses orval 8 with workarounds for a
 * few Umbraco-specific quirks (see relax-untyped-arrays.ts and zod-post-process.ts).
 *
 * `npm run generate` runs `umbraco-mcp-stamp-target-major` after orval, which
 * writes `src/config/umbraco-target.generated.ts` (the Umbraco major the
 * version check compares against). That step owns its own `.env` loading and
 * spec reading, so nothing here needs to know about it.
 */
export default defineConfig({
  // Main API client generation
  exampleApi: {
    input: {
      // Use the included example OpenAPI spec
      // Replace with your add-on's spec path or URL
      target: "./src/umbraco-api/api/openapi.yaml",
      unsafeDisableValidation: true,
      override: {
        transformer: relaxUntypedArrays,
      },
    },
    output: {
      target: "./src/umbraco-api/api/generated/exampleApi.ts",
      client: "axios",
      mode: "single",
      clean: false,
      override: {
        mutator: {
          path: "./src/umbraco-api/api/client.ts",
          name: "customInstance",
        },
      },
    },
    hooks: {
      afterAllFilesWrite: orvalImportFixer as HookFunction,
    },
  },

  // Zod schema generation for validation
  exampleApiZod: {
    input: {
      target: "./src/umbraco-api/api/openapi.yaml",
      unsafeDisableValidation: true,
      override: {
        transformer: relaxUntypedArrays,
      },
    },
    output: {
      target: "./src/umbraco-api/api/generated/exampleApi.zod.ts",
      client: "zod",
      mode: "single",
      clean: false,
      override: {
        zod: {
          dateTimeOptions: {
            local: true,
            offset: true,
          },
          coerce: {
            query: ["number", "boolean"],
          },
        },
      },
    },
    hooks: {
      // Keep the generated zod surface stable across the orval 7 -> 8 upgrade.
      afterAllFilesWrite: postProcessZodFiles as HookFunction,
    },
  },
});
