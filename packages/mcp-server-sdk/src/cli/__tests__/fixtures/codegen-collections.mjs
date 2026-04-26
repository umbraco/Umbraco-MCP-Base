// packages/mcp-server-sdk/src/cli/__tests__/fixtures/codegen-collections.mjs
import { z } from "zod";

const getThing = {
  name: "get-thing",
  description: "Gets a thing",
  inputSchema: { id: z.string().uuid() },
  outputSchema: z.object({ id: z.string(), name: z.string() }),
  slices: ["read"],
  handler: async () => ({ content: [] }),
};

export const collections = [
  {
    metadata: { name: "thing", displayName: "Thing", description: "" },
    tools: () => [getThing],
  },
];
