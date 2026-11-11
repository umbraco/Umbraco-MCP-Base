import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Runs the shipped script as the skill does (node + stdin), not an import of it.
const SCRIPT = path.resolve(process.cwd(), "skills/build-tools/scripts/list-operations.ts");

const spec = {
  paths: {
    "/culture": {
      parameters: [],
      get: { tags: ["Culture"], operationId: "GetCulture", summary: "List cultures" },
    },
    "/order-item/{id}": {
      get: { tags: ["OrderItem"], operationId: "GetOrderItemById", summary: "Get one" },
      delete: { tags: ["OrderItem"], operationId: "DeleteOrderItemById" },
    },
    "/ping": { get: { tags: [], operationId: "Ping" } },
    "/health": { get: { operationId: "Health" } },
  },
};

let dir: string;

function run(
  collection: string | undefined,
  manifest: unknown,
  input: string = JSON.stringify(spec),
  extraArgs: string[] = [],
) {
  fs.writeFileSync(path.join(dir, ".discover.json"), JSON.stringify(manifest));
  const result = spawnSync("node", [SCRIPT, ...(collection ? [collection] : []), ...extraArgs], {
    cwd: dir,
    input,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

const manifest = {
  collections: ["culture", "order-item", "default"],
  collectionTags: { culture: "Culture", "order-item": "OrderItem", default: "default" },
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "list-operations-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("list-operations", () => {
  it("lists only the operations whose first tag is the collection's original tag", () => {
    const { status, stdout } = run("order-item", manifest);

    expect(status).toBe(0);
    expect(stdout.split("\n")).toEqual([
      "GET /order-item/{id} GetOrderItemById - Get one",
      "DELETE /order-item/{id} DeleteOrderItemById",
    ]);
  });

  it("ignores non-operation path keys such as parameters", () => {
    const { stdout } = run("culture", manifest);

    expect(stdout).toBe("GET /culture GetCulture - List cultures");
  });

  it("groups empty and missing tags under default, as discover does", () => {
    const { status, stdout } = run("default", manifest);

    expect(status).toBe(0);
    expect(stdout.split("\n")).toEqual(["GET /ping Ping", "GET /health Health"]);
  });

  it("prints the spec's tags and exits 1 when the manifest has no collectionTags entry", () => {
    const { status, stdout, stderr } = run("order-item", { collections: ["order-item"] });

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Re-run with --tag");
    expect(stderr).toContain("Culture, OrderItem, default");
  });

  it("matches on --tag when given, even without a collectionTags entry", () => {
    const { status, stdout } = run("order-item", { collections: ["order-item"] }, undefined, ["--tag", "OrderItem"]);

    expect(status).toBe(0);
    expect(stdout.split("\n")).toHaveLength(2);
  });

  it("exits 2 with a hint when stdin is not JSON (e.g. an HTML error page)", () => {
    const { status, stderr } = run("culture", manifest, "<html>401</html>");

    expect(status).toBe(2);
    expect(stderr).toContain("not a JSON OpenAPI spec");
  });

  it("exits 2 with usage when no collection is given", () => {
    const { status, stderr } = run(undefined, manifest);

    expect(status).toBe(2);
    expect(stderr).toContain("Usage:");
  });
});
