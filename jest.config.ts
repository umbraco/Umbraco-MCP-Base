/**
 * Root Jest configuration for the monorepo.
 * Uses Jest projects to run tests from all workspaces.
 */
const config: import("@jest/types").Config.InitialOptions = {
  projects: [
    "<rootDir>/packages/toolkit",
    "<rootDir>/template",
  ],
  // Global options (these don't belong in project configs)
  verbose: true,
  forceExit: true,
};

export default config;
