export interface ApiOperation {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  suggestedSlice: string;
}

export interface ApiGroup {
  tag: string;
  operations: ApiOperation[];
  sliceCounts: Record<string, number>;
}

export interface ApiAnalysis {
  title: string;
  groups: ApiGroup[];
  totalOperations: number;
  slicesUsed: string[];
}

interface OpenApiPath {
  [method: string]:
    | {
        tags?: string[];
        operationId?: string;
        summary?: string;
      }
    | undefined;
}

interface OpenApiSpec {
  info?: { title?: string };
  paths?: Record<string, OpenApiPath>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export async function analyzeApi(swaggerUrl: string): Promise<ApiAnalysis> {
  const response = await fetch(swaggerUrl, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${swaggerUrl}: HTTP ${response.status}`);
  }

  const spec = (await response.json()) as OpenApiSpec;
  return analyzeSpec(spec);
}

export function analyzeSpec(spec: OpenApiSpec): ApiAnalysis {
  const title = spec.info?.title || "Unknown API";
  const groupMap = new Map<string, ApiOperation[]>();

  for (const [pathStr, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const tag = operation.tags?.[0] || "default";
      const slice = suggestSlice(method, pathStr, operation.operationId);

      const apiOp: ApiOperation = {
        method: method.toUpperCase(),
        path: pathStr,
        operationId: operation.operationId,
        summary: operation.summary,
        suggestedSlice: slice,
      };

      const existing = groupMap.get(tag) || [];
      existing.push(apiOp);
      groupMap.set(tag, existing);
    }
  }

  const groups: ApiGroup[] = [];
  const allSlices = new Set<string>();

  for (const [tag, operations] of groupMap) {
    const sliceCounts: Record<string, number> = {};
    for (const op of operations) {
      sliceCounts[op.suggestedSlice] =
        (sliceCounts[op.suggestedSlice] || 0) + 1;
      allSlices.add(op.suggestedSlice);
    }
    groups.push({ tag, operations, sliceCounts });
  }

  groups.sort((a, b) => a.tag.localeCompare(b.tag));

  return {
    title,
    groups,
    totalOperations: groups.reduce((sum, g) => sum + g.operations.length, 0),
    slicesUsed: [...allSlices].sort(),
  };
}

function suggestSlice(
  method: string,
  path: string,
  operationId?: string
): string {
  const m = method.toLowerCase();
  const opLower = (operationId || "").toLowerCase();

  if (m === "delete") return "delete";

  if (m === "post") {
    if (opLower.includes("search") || path.includes("/search")) return "search";
    return "create";
  }

  if (m === "put" || m === "patch") return "update";

  if (m === "get") {
    // Heuristics for list vs read
    if (
      opLower.includes("list") ||
      opLower.includes("getall") ||
      opLower.includes("get-all") ||
      path.endsWith("s") && !path.includes("{")
    ) {
      return "list";
    }
    return "read";
  }

  return "other";
}
