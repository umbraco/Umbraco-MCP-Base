/**
 * HTTP reason phrases for status codes.
 *
 * HTTP/2 has no reason phrase, so `Response.statusText` is an empty string on
 * h2 connections (per the Fetch spec). Use `resolveStatusText` wherever the
 * text feeds an error message so 4xx/5xx responses never lose their reason.
 *
 * A static table rather than `node:http` STATUS_CODES: this module is bundled
 * into Cloudflare Workers by hosted-mcp.
 */
const REASON_PHRASES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  507: "Insufficient Storage",
  508: "Loop Detected",
  511: "Network Authentication Required",
};

/**
 * Returns `statusText` when present, else the standard reason phrase for
 * `status`, else an empty string (unknown code).
 */
export function resolveStatusText(status: number, statusText?: string | null): string {
  return statusText || REASON_PHRASES[status] || "";
}
