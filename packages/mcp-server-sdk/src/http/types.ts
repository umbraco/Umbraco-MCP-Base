/**
 * Types shared by the Umbraco fetch clients.
 */

/**
 * Authentication configuration for Umbraco API.
 */
export interface UmbracoFetchAuthConfig {
  /** Base URL of the Umbraco instance */
  baseUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret?: string;
}

/**
 * Options for the Orval mutator.
 * Includes extra fields that Orval-generated code may pass through.
 */
export interface UmbracoManagementClientOptions {
  /** Return full HttpResponse instead of just data */
  returnFullResponse?: boolean;
  /** Custom status validator — when present, prevents throwing on error status codes */
  validateStatus?: ((status: number) => boolean) | null;
  /** Additional headers (used by Orval-generated multipart uploads etc.) */
  headers?: Record<string, string>;
  /** Abort signal for request cancellation */
  signal?: AbortSignal;
  /** Response type hint (ignored by fetch — included for Orval compatibility) */
  responseType?: string;
  /** Allow extra properties from Orval-generated code */
  [key: string]: unknown;
}

/** A request as Orval-generated code passes it to the mutator. */
export type UmbracoRequestConfig = {
  url: string;
  method: string;
  data?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
};
