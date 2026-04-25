// packages/mcp-server-sdk/src/cli/permissive-user.ts
import type { UserModel } from "../types/tool-definition.js";

/**
 * Returns a synthetic user that passes every authorization check that
 * tool collections may apply, regardless of which sections, permissions, or
 * group IDs the consumer's auth policies look for.
 *
 * Used only by `umbraco-mcp-generate-types` to walk every tool exported from
 * `availableCollections` so the generated `.d.ts` covers the full surface.
 */
export function createPermissiveCodegenUser(): UserModel {
  // Array predicates always succeed; index/find/indexOf return a non-empty
  // proxy so chained calls like `.find(...).id.toUpperCase()` work.
  const arrayProxyHandler: ProxyHandler<unknown[]> = {
    get(_target, prop) {
      switch (prop) {
        case "includes":
        case "some":
        case "every":
          return () => true;
        case "find":
          return () => makeArrayProxy(); // return another proxy so chained access works
        case "findIndex":
        case "indexOf":
          return () => 0;
        case "length":
          return 1;
        case Symbol.iterator:
          return function* () {
            yield makeArrayProxy();
          };
        default:
          if (prop === "0") return makeArrayProxy();
          return Reflect.get(_target, prop);
      }
    },
  };

  function makeArrayProxy(): unknown[] {
    return new Proxy([], arrayProxyHandler);
  }

  // The user itself: any property access returns an array-proxy. This means
  // `user.allowedSections.some(...)` and `user.anyFutureField.includes(...)`
  // both work without enumerating valid keys.
  const userProxyHandler: ProxyHandler<object> = {
    get(_target, prop) {
      // Don't proxy symbol-keyed access (e.g. inspect symbols) or `then`
      // (so it isn't accidentally awaited when returned from an async fn).
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return makeArrayProxy();
    },
  };

  return new Proxy({}, userProxyHandler) as UserModel;
}
