#!/usr/bin/env tsx
/**
 * Build the SDK's built-in widgets and emit `dist-html.generated.ts`
 * modules next to each widget source. Runs before tsup so the generated
 * files end up in the published package.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWidgetHtml,
  renderWidgetModuleSource,
  DEFAULT_WIDGET_URI_PREFIX,
} from "../src/widget-build/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const widgetsRoot = resolve(here, "../src/widgets/built-in");

interface BuiltinWidget {
  name: string;
  exportPrefix: string;
}

const widgets: BuiltinWidget[] = [
  { name: "confirm-dialog", exportPrefix: "CONFIRM_DIALOG" },
];

async function main() {
  for (const widget of widgets) {
    const inputDir = resolve(widgetsRoot, widget.name);
    const uri = `${DEFAULT_WIDGET_URI_PREFIX}${widget.name}.html`;
    const outputFile = resolve(inputDir, "dist-html.generated.ts");

    console.log(`[widgets] building ${widget.name}…`);
    const html = await buildWidgetHtml({ inputDir, uri });
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(
      outputFile,
      renderWidgetModuleSource({
        html,
        uri,
        exportPrefix: widget.exportPrefix,
      }),
    );
    console.log(
      `[widgets]   wrote ${widget.name}/dist-html.generated.ts (${html.length.toLocaleString()} bytes)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
