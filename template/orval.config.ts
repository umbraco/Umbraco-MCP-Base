// Loads .env, so the transformer below can ask the connected Umbraco which
// version it is (it needs UMBRACO_BASE_URL / UMBRACO_CLIENT_ID /
// UMBRACO_CLIENT_SECRET, which live there rather than in the shell).
import "./src/load-env.js";

import { defineConfig, type HookFunction } from "orval";
import {
  orvalImportFixer,
  relaxUntypedArrays,
  postProcessZodFiles,
  createUmbracoTargetMajorTransformer,
} from "@umbraco-cms/mcp-server-sdk";

/**
 * Stamps the Umbraco major version this server targets into a generated
 * constant.
 *
 * It cannot come from the spec: every Umbraco Management API spec hard-codes
 * `info.version` to the literal string `"Latest"`, as does the shared config
 * add-ons inherit. So the transformer asks the instance instead — an
 * authenticated `GET /umbraco/management/api/v1/server/information`, using the
 * credentials in `.env` — and only falls back to `info.version` for a committed
 * spec file that carries a real semver (the bundled `openapi.yaml` does).
 *
 * Orval's input transformer is the only extension point that sees the parsed
 * OpenAPI document (the `afterAllFilesWrite` hook only gets file paths), and
 * orval awaits it, so the lookup fits here. After `init`/`discover` repoints
 * `input.target` below, regenerating updates the constant with no extra step
 * and no value to maintain by hand.
 *
 * If neither source works, `npm run generate` fails rather than keeping a stale
 * value — the version check blocks tool execution on a mismatch, so a wrong
 * major is worse than a failed build (Umbraco-MCP-Base#220). There is
 * deliberately no way to pin the major by hand: point `.env` at the Umbraco
 * these tools are for, and it will tell you.
 *
 * The generated file is committed so a fresh scaffold has a working value
 * before anyone runs `generate` themselves.
 */
const stampTargetMajor = createUmbracoTargetMajorTransformer({
  outputPath: "./src/config/umbraco-target.generated.ts",
});

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
        // Transformers compose. `stampTargetMajor` leaves the spec untouched —
        // it only writes src/config/umbraco-target.generated.ts as a side
        // effect of running at generation time. It is async (it may call the
        // instance); orval awaits input transformers, so returning the promise
        // is correct.
        transformer: (spec) => stampTargetMajor(relaxUntypedArrays(spec)),
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
