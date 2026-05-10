#!/usr/bin/env node
/**
 * `umbraco-mcp-widgets` — bundle MCP App widgets into single-file HTML
 * blobs and emit them as TypeScript modules consumers can import.
 *
 * Usage:
 *
 * ```sh
 * umbraco-mcp-widgets build <widgets-dir> [--uri-prefix ui://my-mcp/widgets/]
 * ```
 *
 * `<widgets-dir>` should contain one subdirectory per widget, each with an
 * `index.html`. The CLI emits `<widget>/dist-html.generated.ts` exporting
 * `<EXPORT>_HTML` and `<EXPORT>_URI` for each widget, where `<EXPORT>` is
 * the SCREAMING_SNAKE_CASE form of the widget directory name.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildWidgetHtml,
  renderWidgetModuleSource,
  DEFAULT_WIDGET_URI_PREFIX,
} from "../widget-build/index.js";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags.set(token.slice(2), next);
          i++;
        } else {
          flags.set(token.slice(2), "true");
        }
      }
    } else {
      positional.push(token);
    }
  }

  const command = positional.shift() ?? "";
  return { command, positional, flags };
}

function toScreamingSnake(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replace(/^_|_$/g, "");
}

function printHelp() {
  console.log(`umbraco-mcp-widgets — bundle MCP App widgets into TS modules

Commands:
  build <widgets-dir>    Build every widget under <widgets-dir>.
                         Each subdirectory containing an index.html is built.

Flags:
  --uri-prefix <prefix>  URI prefix for emitted widgets.
                         Default: ${DEFAULT_WIDGET_URI_PREFIX}
  --help                 Show this help.

Output: writes <widgets-dir>/<widget>/dist-html.generated.ts for each widget.`);
}

async function buildAll(args: ParsedArgs) {
  const widgetsDir = args.positional[0];
  if (!widgetsDir) {
    console.error("error: build requires a <widgets-dir> argument");
    printHelp();
    process.exit(1);
  }
  const root = resolve(process.cwd(), widgetsDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: ${root} is not a directory`);
    process.exit(1);
  }

  const uriPrefix = args.flags.get("uri-prefix") ?? DEFAULT_WIDGET_URI_PREFIX;
  const entries = readdirSync(root).filter((name) => {
    const path = resolve(root, name);
    return (
      statSync(path).isDirectory() && existsSync(resolve(path, "index.html"))
    );
  });

  if (entries.length === 0) {
    console.warn(
      `warning: no widget directories with index.html found under ${root}`,
    );
    return;
  }

  for (const name of entries) {
    const inputDir = resolve(root, name);
    const uri = `${uriPrefix}${name}.html`;
    const outputFile = resolve(inputDir, "dist-html.generated.ts");
    const exportPrefix = toScreamingSnake(name);

    console.log(`[widgets] building ${name} → ${uri}`);
    const html = await buildWidgetHtml({ inputDir, uri });
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(
      outputFile,
      renderWidgetModuleSource({ html, uri, exportPrefix }),
    );
    console.log(
      `[widgets]   ${name}/dist-html.generated.ts (${html.length.toLocaleString()} bytes, exports ${exportPrefix}_HTML / ${exportPrefix}_URI)`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.get("help") === "true" || args.command === "help") {
    printHelp();
    return;
  }

  switch (args.command) {
    case "":
      printHelp();
      process.exit(1);
      break;
    case "build":
      await buildAll(args);
      break;
    default:
      console.error(`error: unknown command "${args.command}"`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
