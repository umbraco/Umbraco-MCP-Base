import * as fs from "node:fs";
import * as path from "node:path";

export function removeExamples(projectDir: string): number {
  let changes = 0;

  // Remove example tool directories
  const exampleDir = path.join(
    projectDir,
    "src",
    "umbraco-api",
    "tools",
    "example"
  );
  const example2Dir = path.join(
    projectDir,
    "src",
    "umbraco-api",
    "tools",
    "example-2"
  );

  if (fs.existsSync(exampleDir)) {
    fs.rmSync(exampleDir, { recursive: true, force: true });
    changes++;
  }

  if (fs.existsSync(example2Dir)) {
    fs.rmSync(example2Dir, { recursive: true, force: true });
    changes++;
  }

  // Update src/index.ts - remove example imports and registrations
  const indexTsPath = path.join(projectDir, "src", "index.ts");
  if (fs.existsSync(indexTsPath)) {
    let content = fs.readFileSync(indexTsPath, "utf-8");
    const original = content;

    // Remove example collection imports
    content = content.replace(
      /^import exampleCollection from ["']\.\/umbraco-api\/tools\/example\/index\.js["'];?\s*\n/m,
      ""
    );
    content = content.replace(
      /^import example2Collection from ["']\.\/umbraco-api\/tools\/example-2\/index\.js["'];?\s*\n/m,
      ""
    );

    // Remove from collections array
    content = content.replace(/exampleCollection,?\s*/g, "");
    content = content.replace(/example2Collection,?\s*/g, "");

    // Clean up potential double commas or trailing commas before ]
    content = content.replace(/,\s*,/g, ",");
    content = content.replace(/\[\s*,/g, "[");
    content = content.replace(/,\s*\]/g, "]");

    if (content !== original) {
      fs.writeFileSync(indexTsPath, content);
      changes++;
    }
  }

  // Update src/config/mode-registry.ts - remove example modes
  const modeRegistryPath = path.join(
    projectDir,
    "src",
    "config",
    "mode-registry.ts"
  );
  if (fs.existsSync(modeRegistryPath)) {
    let content = fs.readFileSync(modeRegistryPath, "utf-8");
    const original = content;

    content = content.replace(
      /\s*\{\s*name:\s*['"]example['"][\s\S]*?collections:\s*\[['"]example['"]\]\s*\},?/g,
      ""
    );
    content = content.replace(
      /\s*\{\s*name:\s*['"]example-2['"][\s\S]*?collections:\s*\[['"]example-2['"]\]\s*\},?/g,
      ""
    );
    content = content.replace(
      /\s*\{\s*name:\s*['"]all-examples['"][\s\S]*?collections:\s*\[['"]example['"],\s*['"]example-2['"]\]\s*\},?/g,
      ""
    );

    // Clean up trailing commas and empty arrays
    content = content.replace(/,(\s*\])/g, "$1");
    content = content.replace(/\[\s*,/g, "[");

    if (content !== original) {
      fs.writeFileSync(modeRegistryPath, content);
      changes++;
    }
  }

  return changes;
}
