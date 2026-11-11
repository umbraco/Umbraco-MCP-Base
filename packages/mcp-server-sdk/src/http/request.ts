/**
 * The request path shared by the singleton and factory clients: query string,
 * headers, the 401 resend, response parsing and error throwing.
 */

import { HttpResponse } from "../helpers/api-call-helpers.js";
import { resolveStatusText } from "../helpers/status-text.js";
import { buildFetchBody } from "./fetch-body.js";
import type { UmbracoManagementClientOptions, UmbracoRequestConfig } from "./types.js";

/**
 * Serializes params for Umbraco API calls.
 * Handles array params in repeat format (e.g., id=1&id=2).
 * Replaces the `qs` library.
 */
export function serializeParams(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * Logs a failed request to stderr. Only status, method and path are written by
 * default: error bodies (e.g. `application/problem+json`) can echo submitted
 * values such as member names or emails, and MCP clients capture a stdio
 * server's stderr in their own log files. The full body is written only when
 * the caller opts in (`enableLogging` on the factory, or the
 * `UMBRACO_MCP_LOG_ERROR_BODIES=true` env var for the singleton client).
 * @internal
 */
export function logHttpError(
  status: number,
  method: string,
  url: string,
  data: unknown,
  includeBody: boolean
): void {
  const path = url.split("?")[0];
  const line = `HTTP Error: ${status} ${method.toUpperCase()} ${path}`;
  if (includeBody) {
    console.error(line, data);
  } else {
    console.error(line);
  }
}

/** True when every Authorization header in `headers` carries our cached token. */
function sentOurToken(headers: Record<string, string>, token: string): boolean {
  return Object.entries(headers).every(
    ([name, value]) => name.toLowerCase() !== "authorization" || value === `Bearer ${token}`
  );
}

/**
 * True when a 401 is a bearer-token challenge from the token validation
 * middleware (`WWW-Authenticate: Bearer …`), i.e. the token itself was refused.
 * An endpoint that returns 401 from its own code (Umbraco does this for some
 * permission checks) sends no challenge, and a fresh token wouldn't help.
 */
function isBearerChallenge(resp: Response): boolean {
  return /(?:^|,)\s*Bearer\b/i.test(resp.headers.get("www-authenticate") ?? "");
}

/** What differs between the singleton and factory clients. */
export interface UmbracoRequestAuth {
  baseUrl: string;
  /** Returns a valid token; the request's signal bounds the wait. */
  getToken: (signal?: AbortSignal) => Promise<string>;
  /**
   * Called when Umbraco refused `token` with a bearer challenge. Drops it from
   * the cache and returns true to resend with a fresh token, or false to return
   * the 401 as is (e.g. the client was re-initialised meanwhile).
   */
  onTokenRejected: (token: string) => boolean;
  /** Write full error bodies to stderr (see logHttpError). */
  logErrorBodies: boolean;
  /** Write each request and response line to stderr. */
  logRequests?: boolean;
}

/**
 * Sends one request to the Umbraco API. The single request path for both the
 * singleton and factory clients, so headers, the 401 resend, response parsing
 * and error throwing cannot drift between them (umbraco/Umbraco-MCP-Base#446).
 * @internal
 */
export async function executeUmbracoRequest<T>(
  auth: UmbracoRequestAuth,
  config: UmbracoRequestConfig,
  options?: UmbracoManagementClientOptions
): Promise<HttpResponse<T> | T> {
  // The request's signal bounds the wait for the token too: without it a CMS
  // that accepts the connection but never answers the token request would hang
  // the caller whatever deadline it set (umbraco/Umbraco-MCP-Base#428).
  const token = await auth.getToken(options?.signal);
  const queryString = serializeParams(config.params);
  const fullUrl = `${auth.baseUrl}${config.url}${queryString}`;

  const { body, skipDefaultContentType } = await buildFetchBody(config.data, options?.signal);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(skipDefaultContentType ? {} : { "Content-Type": "application/json" }),
    Accept: "application/json",
    ...config.headers,
    ...options?.headers,
  };

  const fetchOptions: RequestInit = {
    method: config.method,
    headers,
    signal: options?.signal,
  };

  if (body !== undefined) {
    fetchOptions.body = body;
  }

  const send = async (): Promise<Response> => {
    if (auth.logRequests) {
      console.error("Request:", config.method.toUpperCase(), config.url);
    }
    const response = await fetch(fullUrl, fetchOptions);
    if (auth.logRequests) {
      console.error("Response:", response.status, config.url);
    }
    return response;
  };

  let resp = await send();

  // Resend once with a fresh token when the token itself was refused. Only a
  // bearer challenge counts: it comes from token validation, before the
  // endpoint runs, so resending is safe for every method. Done before the
  // returnFullResponse branch so tool calls (which return the 401) get it too.
  // Skipped when the caller supplied its own Authorization header, or when the
  // client was re-initialised meanwhile (the new token belongs to another config).
  if (
    resp.status === 401
    && isBearerChallenge(resp)
    && !options?.signal?.aborted
    && sentOurToken(headers, token)
    && auth.onTokenRejected(token)
  ) {
    void resp.body?.cancel().catch(() => {});
    headers.Authorization = `Bearer ${await auth.getToken(options?.signal)}`;
    resp = await send();
  }

  // Parse response body
  let data: T;
  const contentType = resp.headers.get("content-type") ?? "";
  // Parse anything JSON: `application/json` plus the `+json` structured-syntax
  // suffix (RFC 6839), e.g. `application/problem+json` used by RFC 7807 error
  // bodies. Umbraco 18 returns Management API errors as `application/problem+json`,
  // so without the suffix check they'd pass through unparsed as raw strings.
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    data = (await resp.json()) as T;
  } else {
    const text = await resp.text();
    data = (text || undefined) as T;
  }

  // Collect response headers
  const responseHeaders: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const returnFullResponse = options?.returnFullResponse;

  if (returnFullResponse) {
    return {
      status: resp.status,
      statusText: resolveStatusText(resp.status, resp.statusText),
      data,
      headers: responseHeaders,
    } satisfies HttpResponse<T>;
  }

  // Without returnFullResponse, check status and throw or return data
  if (!options?.validateStatus && resp.status >= 400) {
    logHttpError(resp.status, config.method, config.url, data, auth.logErrorBodies);
    const error = new Error(
      `Request failed with status ${resp.status}: ${resolveStatusText(resp.status, resp.statusText)}`
    );
    (error as any).response = { status: resp.status, data };
    throw error;
  }

  return data;
}
