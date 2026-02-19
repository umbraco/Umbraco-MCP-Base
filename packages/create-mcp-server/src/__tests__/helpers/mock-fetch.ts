/**
 * URL-pattern-based fetch mock.
 */

export interface MockRoute {
  /** String to match against URL (substring match) */
  pattern: string;
  /** Response body (object will be JSON-serialized) */
  body: unknown;
  /** HTTP status (default 200) */
  status?: number;
  /** Response headers */
  headers?: Record<string, string>;
}

export function createMockFetch(routes: MockRoute[]): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    for (const route of routes) {
      if (url.includes(route.pattern)) {
        const status = route.status ?? 200;
        const bodyStr =
          typeof route.body === "string"
            ? route.body
            : JSON.stringify(route.body);
        const headers = new Headers(route.headers);

        return {
          ok: status >= 200 && status < 300,
          status,
          headers,
          json: async () => {
            if (typeof route.body === "string") {
              try {
                return JSON.parse(route.body);
              } catch {
                throw new SyntaxError(`Failed to parse JSON: ${route.body.slice(0, 50)}`);
              }
            }
            return route.body;
          },
          text: async () => bodyStr,
        } as Response;
      }
    }

    return {
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({ error: "No mock route matched" }),
      text: async () => "Not Found",
    } as Response;
  }) as typeof globalThis.fetch;
}
