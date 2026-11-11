/**
 * Request body building, shared by every Umbraco fetch client.
 */

/** Stream FormData from the `form-data` package (Node only). */
interface StreamFormData {
  getHeaders: () => Record<string, string>;
  pipe: Function;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  resume: () => unknown;
  destroy?: () => unknown;
}

/**
 * Collects a stream FormData into one Uint8Array. The `form-data` package emits
 * a CombinedStream which is not async-iterable, so chunks come via 'data'.
 * Uses no Node globals (Buffer), so it runs in Workers too, and the signal
 * bounds the wait: a stream that never ends (e.g. one already drained by an
 * earlier attempt) would otherwise hang the request whatever deadline was set.
 */
function collectStreamFormData(fd: StreamFormData, signal?: AbortSignal): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      reject(signal!.reason);
      fd.destroy?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => signal?.removeEventListener("abort", onAbort);

    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    fd.on("data", (chunk: string | Uint8Array) =>
      chunks.push(typeof chunk === "string" ? encoder.encode(chunk) : chunk));
    fd.on("end", () => {
      done();
      const body = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(body);
    });
    fd.on("error", (error: unknown) => {
      done();
      reject(error);
    });
    fd.resume();
  });
}

/**
 * Builds the fetch body for a request payload and says whether the default
 * `Content-Type: application/json` must be left off. Shared by every Umbraco
 * fetch client (the singleton and factory here, and `@umbraco-cms/mcp-hosted`)
 * so they cannot drift (umbraco/Umbraco-MCP-Base#446). Works in Node and Workers.
 *
 * Supported payloads:
 *   - undefined: no body.
 *   - Web FormData (globalThis.FormData; Workers and Node 18+): passed straight
 *     to fetch, which sets the multipart Content-Type with boundary.
 *   - Stream FormData (`form-data` package, Node only; has getHeaders()/pipe()):
 *     collected into a Uint8Array for native fetch. The caller supplies the
 *     multipart Content-Type through its own headers (from getHeaders()).
 *   - anything else: JSON.stringify.
 *
 * @param signal - The request's abort signal; bounds collecting a stream body.
 *   Without one, a stream that never ends (e.g. one already drained) still hangs.
 * @internal Exported for `@umbraco-cms/mcp-hosted` (released in lockstep); not a
 *   supported public API, so its shape may change in any release.
 */
export async function buildFetchBody(
  data: unknown,
  signal?: AbortSignal,
): Promise<{ body?: BodyInit; skipDefaultContentType: boolean }> {
  const isWebFormData = data != null
    && typeof (globalThis as any).FormData !== "undefined"
    && data instanceof (globalThis as any).FormData;
  const isStreamFormData = !isWebFormData
    && data != null
    && typeof (data as any).getHeaders === "function"
    && typeof (data as any).pipe === "function";
  const skipDefaultContentType = isWebFormData || isStreamFormData;

  if (data === undefined) return { skipDefaultContentType };
  if (isWebFormData) return { body: data as FormData, skipDefaultContentType };
  if (isStreamFormData) {
    const body = await collectStreamFormData(data as StreamFormData, signal);
    return { body: body as unknown as BodyInit, skipDefaultContentType };
  }
  return { body: JSON.stringify(data), skipDefaultContentType };
}
