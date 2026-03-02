/**
 * Root Jest configuration for the monorepo.
 * Uses Jest projects to run tests from all workspaces.
 */
const config: import("@jest/types").Config.InitialOptions = {
  projects: [
    "<rootDir>/packages/mcp-server-sdk",
    "<rootDir>/packages/hosted-mcp",
    "<rootDir>/packages/create-mcp-server",
    "<rootDir>/template",
    "<rootDir>/plugins",
  ],
  // Global options (these don't belong in project configs)
  verbose: true,
  forceExit: true,
};

export default config;
