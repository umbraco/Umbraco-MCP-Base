/**
 * MSW Server for Node.js
 *
 * Sets up MSW server for use in Jest tests.
 * Import this in your test setup files.
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

export const server = setupServer(...handlers);
