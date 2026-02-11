export interface PermissionInfo {
  authSchemeType?: string;
  authSchemeName?: string;
  scopes: string[];
  authenticatedCount: number;
  unauthenticatedCount: number;
  totalOperations: number;
}

interface OpenApiSecurityScheme {
  type?: string;
  flows?: Record<
    string,
    {
      scopes?: Record<string, string>;
    }
  >;
}

interface OpenApiSpec {
  paths?: Record<
    string,
    Record<
      string,
      | {
          security?: Array<Record<string, string[]>>;
        }
      | undefined
    >
  >;
  components?: {
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
}

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
];

export function extractPermissions(spec: OpenApiSpec): PermissionInfo {
  const result: PermissionInfo = {
    scopes: [],
    authenticatedCount: 0,
    unauthenticatedCount: 0,
    totalOperations: 0,
  };

  // Extract security scheme info
  const schemes = spec.components?.securitySchemes;
  if (schemes) {
    for (const [name, scheme] of Object.entries(schemes)) {
      if (scheme.type) {
        result.authSchemeType = scheme.type;
        result.authSchemeName = name;
      }

      // Collect scopes from OAuth2 flows
      if (scheme.flows) {
        for (const flow of Object.values(scheme.flows)) {
          if (flow.scopes) {
            result.scopes.push(...Object.keys(flow.scopes));
          }
        }
      }
    }
  }

  // Count authenticated vs unauthenticated operations
  const globalSecurity = spec.security;

  for (const pathItem of Object.values(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      result.totalOperations++;

      // Operation-level security overrides global
      const security = operation.security ?? globalSecurity;

      if (security && security.length > 0) {
        // Check if any security entry has an empty object (no auth required)
        const hasEmptyEntry = security.some(
          (entry) => Object.keys(entry).length === 0
        );
        if (hasEmptyEntry) {
          result.unauthenticatedCount++;
        } else {
          result.authenticatedCount++;

          // Collect scopes from operation-level security
          for (const entry of security) {
            for (const scopeList of Object.values(entry)) {
              result.scopes.push(...scopeList);
            }
          }
        }
      } else if (!globalSecurity) {
        result.unauthenticatedCount++;
      } else {
        result.authenticatedCount++;
      }
    }
  }

  // Deduplicate scopes
  result.scopes = [...new Set(result.scopes)].sort();

  return result;
}
