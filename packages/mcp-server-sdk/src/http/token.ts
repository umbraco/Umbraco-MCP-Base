/**
 * Client-credentials token exchange and auth config validation, shared by the
 * singleton and factory clients and the build-time target-major writer.
 */

import { resolveStatusText } from "../helpers/status-text.js";
import { assertTlsNotDisabledForRemote, normalizeBaseUrl } from "../helpers/url.js";
import type { UmbracoFetchAuthConfig } from "./types.js";

export const DEFAULT_TOKEN_PATH = "/umbraco/management/api/v1/security/back-office/token";

/**
 * Performs the client-credentials token exchange against Umbraco.
 *
 * The one place this request is built. Both the singleton and per-instance
 * clients below wrap it with their own token caching, and the build-time
 * target-major writer uses it too — the request itself is identical in all
 * three, so it lives here rather than being re-implemented per caller.
 *
 * @throws If the token endpoint returns a non-2xx response
 */
export const requestClientCredentialsToken = async (config: {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  tokenPath?: string;
  /** Forwarded to `fetch`, so callers can impose their own deadline. */
  signal?: AbortSignal;
}): Promise<{ accessToken: string; expiresIn: number }> => {
  const {
    baseUrl,
    clientId,
    clientSecret,
    tokenPath = DEFAULT_TOKEN_PATH,
    signal,
  } = config;

  assertTlsNotDisabledForRemote(baseUrl);
  const response = await fetch(`${baseUrl}${tokenPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret ?? "",
      grant_type: "client_credentials",
    }).toString(),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Token request failed: ${response.status} ${resolveStatusText(response.status, response.statusText)}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
};

/**
 * Validates an auth config, applies the TLS check and normalizes the base URL.
 * @internal
 */
export function resolveAuthConfig(config: UmbracoFetchAuthConfig): UmbracoFetchAuthConfig {
  const { clientId, clientSecret, baseUrl } = config;

  if (!baseUrl) {
    throw new Error("Missing required configuration: baseUrl");
  }
  if (!clientId) {
    throw new Error("Missing required configuration: clientId");
  }
  if (!clientSecret && clientId !== "umbraco-swagger") {
    throw new Error("Missing required configuration: clientSecret");
  }

  assertTlsNotDisabledForRemote(baseUrl);
  return { ...config, baseUrl: normalizeBaseUrl(baseUrl) };
}
