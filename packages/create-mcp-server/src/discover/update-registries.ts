import * as fs from "node:fs";
import * as path from "node:path";
import type { SuggestedMode } from "./suggest-modes.js";

export function updateModeRegistry(
  projectDir: string,
  modes: SuggestedMode[]
): number {
  const filePath = path.join(projectDir, "src/config/mode-registry.ts");

  if (!fs.existsSync(filePath)) {
    return 0;
  }

  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;
  let added = 0;

  for (const mode of modes) {
    // Skip if mode already exists
    if (content.includes(`name: '${mode.name}'`)) {
      continue;
    }

    const modeEntry = [
      `  {`,
      `    name: '${mode.name}',`,
      `    displayName: '${mode.displayName}',`,
      `    description: '${mode.description}',`,
      `    collections: [${mode.collections.map((c) => `'${c}'`).join(", ")}]`,
      `  },`,
    ].join("\n");

    // Insert before the closing marker comment or closing bracket
    const insertMarker = "// Add your modes here";
    if (content.includes(insertMarker)) {
      content = content.replace(
        insertMarker,
        `${modeEntry}\n  ${insertMarker}`
      );
    } else {
      // Insert before the closing ]; of the toolModes array
      content = content.replace(
        /^(export const toolModes:[^;]*?)(];)/ms,
        `$1${modeEntry}\n$2`
      );
    }

    added++;
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content);
  }

  return added;
}

export function updateSliceRegistry(
  projectDir: string,
  slices: string[]
): number {
  const filePath = path.join(projectDir, "src/config/slice-registry.ts");

  if (!fs.existsSync(filePath)) {
    return 0;
  }

  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;
  let added = 0;

  for (const slice of slices) {
    // Skip if slice already exists (check both quoted forms)
    if (content.includes(`'${slice}'`) || content.includes(`"${slice}"`)) {
      continue;
    }

    // Insert before the closing ] as const of toolSliceNames
    content = content.replace(
      /^(export const toolSliceNames\s*=\s*\[.*?)(] as const;)/ms,
      `$1\n  // Discovered\n  '${slice}',\n$2`
    );

    added++;
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content);
  }

  return added;
}
