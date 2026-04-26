// packages/mcp-server-sdk/src/cli/permissive-user.ts

/**
 * Returns a synthetic user that passes every authorization check that
 * tool collections may apply, regardless of which sections, permissions, or
 * group IDs the consumer's auth policies look for.
 *
 * Used only by `umbraco-mcp-generate-types` to walk every tool exported from
 * `availableCollections` so the generated `.d.ts` covers the full surface.
 *
 * **Contract:** the returned object is only safe to pass to
 * `collection.tools(user)` — do **not** read its properties directly.
 * Every property access returns an array-proxy, not the scalar value
 * (`user.id` is not a string). The return type is `unknown` to force
 * callers through the only intended use.
 *
 * **Supported array predicates** (always succeed): `includes`, `some`,
 * `every`, `find`, `findIndex`, `indexOf`, `Symbol.iterator`. Other
 * iteration methods (`filter`, `map`, `reduce`, `forEach`) fall through
 * to a real empty array and may return falsy results — if a tool's
 * `enabled(user)` predicate uses those methods, the tool may be dropped
 * from the generated types.
 */
export function createPermissiveCodegenUser(): unknown {
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

  return new Proxy({}, userProxyHandler);
}
