/**
 * Loads .env quietly.
 *
 * dotenv 17 prints a banner to stdout when it loads (e.g.
 * "◇ injected env (0) from .env"). This server's stdout carries MCP protocol
 * traffic on stdio, and the CLI's introspection commands (--describe-tool,
 * --debug-config) emit machine-readable JSON, so anything extra on stdout
 * corrupts them.
 *
 * `import "dotenv/config"` cannot be passed options — it only reads
 * DOTENV_CONFIG_QUIET from the environment, which can't be set before its own
 * import. Importing this module instead keeps the same load ordering (ESM
 * evaluates imported modules before the importing module's body) while
 * silencing the banner.
 */
import { config } from "dotenv";

config({ quiet: true });
