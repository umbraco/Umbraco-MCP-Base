import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { runInit } from "./init/index.js";
import { runDiscover } from "./discover/index.js";
import { promptForProjectName } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Route to subcommands
  if (args[0] === "init") {
    await runInit(args[1]);
    return;
  }

  if (args[0] === "discover") {
    await runDiscover(args[1]);
    return;
  }

  console.log(pc.bold(pc.cyan("\nCreate Umbraco MCP Server\n")));

  // Get project name from argument or prompt
  let projectName: string;

  if (args.length > 0 && !args[0].startsWith("-")) {
    projectName = args[0];
  } else {
    const options = await promptForProjectName();
    if (!options) {
      process.exit(1);
    }
    projectName = options.projectName;
  }

  // Validate project name
  if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
    console.error(
      pc.red(
        "Error: Project name can only contain letters, numbers, hyphens, and underscores."
      )
    );
    process.exit(1);
  }

  // Determine target directory
  const targetDir = path.resolve(process.cwd(), projectName);

  // Check if directory already exists
  if (fs.existsSync(targetDir)) {
    console.error(
      pc.red(
        `\nError: Directory "${projectName}" already exists.\n` +
          "Remove it or choose a different name."
      )
    );
    process.exit(1);
  }

  // Scaffold the project
  try {
    scaffoldProject({
      projectName,
      targetDir,
    });
  } catch (error) {
    console.error(
      pc.red(`\nError: ${error instanceof Error ? error.message : error}`)
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(pc.red(`\nUnexpected error: ${error}`));
  process.exit(1);
});
