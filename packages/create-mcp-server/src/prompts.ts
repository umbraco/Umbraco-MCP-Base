import prompts from "prompts";
import pc from "picocolors";

export interface ProjectOptions {
  projectName: string;
}

/**
 * Prompt the user for project configuration when no arguments are provided.
 */
export async function promptForProjectName(): Promise<ProjectOptions | null> {
  const response = await prompts(
    {
      type: "text",
      name: "projectName",
      message: "What is your project name?",
      initial: "My-Umbraco-MCP",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Project name is required";
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
          return "Project name can only contain letters, numbers, hyphens, and underscores";
        }
        return true;
      },
    },
    {
      onCancel: () => {
        console.log(pc.yellow("\nOperation cancelled."));
        return false;
      },
    }
  );

  if (!response.projectName) {
    return null;
  }

  return {
    projectName: response.projectName,
  };
}
