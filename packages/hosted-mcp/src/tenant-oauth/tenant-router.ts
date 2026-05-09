/**
 * Tenant-prefixed OAuth router.
 *
 * Intercepts requests to /at/<alias>/{authorize,token,register,callback,
 * .well-known/oauth-authorization-server} and the per-tenant PRM at
 * /.well-known/oauth-protected-resource/at/<alias>, before they reach
 * OAuthProvider. Validates the alias, enforces the per-tenant client binding,
 * synthesises/cross-validates `resource`, then strips the prefix and forwards
 * to OAuthProvider's root handlers.
 *
 * Companion to site-routing/site-router.ts, which handles /at/<alias>/mcp.
 */

import type { HostedMcpEnv } from "../types/env.js";
import type { SiteRoutingConfig } from "../types/multi-site.js";
import {
  resolveAliasFromUrl,
  canonicalResourceForAlias,
} from "../site-routing/internal/alias-context.js";
import { putClientBinding, hasClientBinding } from "./binding-store.js";
import { validateResourceMatch } from "./resource-match.js";

export type TenantOAuthKind =
  | "authorize"
  | "token"
  | "register"
  | "callback"
  | "as-metadata"
  | "prm";

export interface TenantOAuthMatch {
  kind: TenantOAuthKind;
  alias: string;
}

const RFC_8414_AS_METADATA_REGEX =
  /^\/\.well-known\/oauth-authorization-server\/at\/([^/]+)\/?$/;
const PRM_REGEX = /^\/\.well-known\/oauth-protected-resource\/at\/([^/]+)\/?$/;
const TENANT_OP_REGEX =
  /^\/at\/([^/]+)\/(authorize|token|register|callback|\.well-known\/oauth-authorization-server)\/?$/;

/**
 * Recognise a tenant-OAuth path and extract its kind + alias. Does NOT match
 * /at/<alias>/mcp — that's handled by site-router. Does NOT match the bare
 * /at/<alias>/ — that's the MCP endpoint without a sub-path.
 */
export function matchTenantOAuthPath(pathname: string): TenantOAuthMatch | null {
  const m1 = pathname.match(RFC_8414_AS_METADATA_REGEX);
  if (m1) return { kind: "as-metadata", alias: m1[1] };

  const m2 = pathname.match(PRM_REGEX);
  if (m2) return { kind: "prm", alias: m2[1] };

  const m3 = pathname.match(TENANT_OP_REGEX);
  if (m3) {
    const alias = m3[1];
    const op = m3[2];
    if (op === ".well-known/oauth-authorization-server") {
      return { kind: "as-metadata", alias };
    }
    return { kind: op as TenantOAuthKind, alias };
  }

  return null;
}

/**
 * RFC 8414 authorization-server metadata for a single tenant. All endpoints
 * are tenant-prefixed; clients that walk this doc never lose the alias.
 */
export function renderTenantAuthorizationServerMetadata(
  origin: string,
  alias: string,
  request: Request
): Response {
  if (request.method === "OPTIONS") {
    return corsPreflight();
  }
  const tenantBase = `${origin}/at/${alias}`;
  const body = {
    issuer: tenantBase,
    authorization_endpoint: `${tenantBase}/authorize`,
    token_endpoint: `${tenantBase}/token`,
    registration_endpoint: `${tenantBase}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["openid", "offline_access"],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

interface OAuthProviderLike {
  fetch(
    request: Request,
    env: HostedMcpEnv,
    ctx: ExecutionContext
  ): Promise<Response>;
}

/**
 * Dispatch a tenant-OAuth request: validate alias, enforce binding (where
 * relevant), strip the /at/<alias>/ prefix, and forward to OAuthProvider.
 *
 * `as-metadata` and `prm` are rendered locally (no OAuthProvider involvement).
 * `register` writes binding records on success. `authorize` and `token` check
 * the forward binding and reject 400 invalid_client on miss.
 */
export async function dispatchTenantOAuth(
  match: TenantOAuthMatch,
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext,
  siteRouting: SiteRoutingConfig,
  oauthProvider: OAuthProviderLike
): Promise<Response> {
  const url = new URL(request.url);

  // PRM and AS metadata are public — but we still validate alias exists so
  // unknown tenants get a clean 404.
  if (match.kind === "as-metadata" || match.kind === "prm") {
    const resolution = await resolveAliasFromUrl(
      new URL(`/at/${match.alias}/`, url.origin),
      siteRouting,
      env
    );
    if ("rejected" in resolution) return resolution.rejected;
    if (match.kind === "as-metadata") {
      return renderTenantAuthorizationServerMetadata(url.origin, match.alias, request);
    }
    return renderProtectedResourceMetadataForTenant(url.origin, match.alias, request);
  }

  // For authorize/token/register/callback — alias must resolve to a real site.
  const resolution = await resolveAliasFromUrl(
    new URL(`/at/${match.alias}/`, url.origin),
    siteRouting,
    env
  );
  if ("rejected" in resolution) return resolution.rejected;

  if (match.kind === "register") {
    return dispatchRegister(match.alias, request, env, ctx, oauthProvider);
  }

  if (match.kind === "callback") {
    // /at/<alias>/callback — Umbraco's redirect comes back here. The existing
    // callback handler accepts /callback/:siteId; the worker entry routes
    // tenant-prefixed callbacks via that path. Forward unchanged so OAuthProvider
    // (or our default handler) sees the request as-is.
    return oauthProvider.fetch(request, env, ctx);
  }

  if (match.kind === "authorize" || match.kind === "token") {
    return dispatchAuthorizeOrToken(
      match.kind,
      match.alias,
      request,
      env,
      ctx,
      oauthProvider
    );
  }

  // Unreachable
  throw new Error(`dispatchTenantOAuth: unhandled kind=${(match as { kind: string }).kind}`);
}

async function dispatchRegister(
  alias: string,
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext,
  oauthProvider: OAuthProviderLike
): Promise<Response> {
  const url = new URL(request.url);
  const stripped = new URL("/register", url.origin);
  stripped.search = url.search;

  const forwarded = new Request(stripped.toString(), request);
  const response = await oauthProvider.fetch(forwarded, env, ctx);

  // Only persist bindings on a 2xx response.
  if (response.status < 200 || response.status >= 300) {
    return response;
  }

  const cloned = response.clone();
  let parsed: { client_id?: unknown } = {};
  try {
    parsed = (await cloned.json()) as { client_id?: unknown };
  } catch {
    return response;
  }

  const clientId = typeof parsed.client_id === "string" ? parsed.client_id : null;
  if (!clientId) return response;

  await putClientBinding(env.OAUTH_KV, alias, clientId);
  return response;
}

async function dispatchAuthorizeOrToken(
  kind: "authorize" | "token",
  alias: string,
  request: Request,
  env: HostedMcpEnv,
  ctx: ExecutionContext,
  oauthProvider: OAuthProviderLike
): Promise<Response> {
  const url = new URL(request.url);
  const canonical = canonicalResourceForAlias(url.origin, alias);

  const parsed = await readClientIdAndResource(request);
  if (!parsed.clientId) {
    return jsonError(400, "invalid_request", "client_id is required");
  }

  if (!(await hasClientBinding(env.OAUTH_KV, alias, parsed.clientId))) {
    return jsonError(400, "invalid_client", "Client not registered for this site");
  }

  const validation = validateResourceMatch(parsed.sentResource, canonical);
  if (!validation.ok) {
    return jsonError(400, "invalid_request", validation.reason);
  }

  // Strip prefix; carry query params; synthesise resource if absent.
  const stripped = new URL(`/${kind}`, url.origin);
  for (const [k, v] of url.searchParams) stripped.searchParams.append(k, v);
  if (parsed.sentResource === undefined || parsed.sentResource === "") {
    stripped.searchParams.set("resource", canonical);
  }

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    if (parsed.formClone !== null) {
      if (parsed.sentResource === undefined || parsed.sentResource === "") {
        parsed.formClone.set("resource", canonical);
      }
      init.body = parsed.formClone.toString();
      // Headers already includes content-type from original request
    } else {
      init.body = request.body;
      (init as { duplex?: string }).duplex = "half";
    }
  }

  const forwarded = new Request(stripped.toString(), init);
  return oauthProvider.fetch(forwarded, env, ctx);
}

interface ParsedRequest {
  clientId: string | null;
  sentResource: string | string[] | undefined;
  formClone: URLSearchParams | null;
}

async function readClientIdAndResource(request: Request): Promise<ParsedRequest> {
  const url = new URL(request.url);
  const queryClientId = url.searchParams.get("client_id");
  const queryResource = url.searchParams.getAll("resource");
  const queryResourceValue = collapseResource(queryResource);

  if (request.method === "GET" || request.method === "HEAD") {
    return {
      clientId: queryClientId,
      sentResource: queryResourceValue,
      formClone: null,
    };
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.clone().text();
    const form = new URLSearchParams(text);
    const formResource = form.getAll("resource");
    const formResourceValue =
      formResource.length > 0 ? collapseResource(formResource) : queryResourceValue;
    return {
      clientId: form.get("client_id") ?? queryClientId,
      sentResource: formResourceValue,
      formClone: form,
    };
  }

  return {
    clientId: queryClientId,
    sentResource: queryResourceValue,
    formClone: null,
  };
}

function collapseResource(values: string[]): string | string[] | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return values;
}

function jsonError(status: number, error: string, error_description: string): Response {
  return new Response(JSON.stringify({ error, error_description }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderProtectedResourceMetadataForTenant(
  origin: string,
  alias: string,
  request: Request
): Response {
  if (request.method === "OPTIONS") {
    return corsPreflight();
  }
  const tenantBase = `${origin}/at/${alias}`;
  return new Response(
    JSON.stringify({
      resource: tenantBase,
      authorization_servers: [tenantBase],
      bearer_methods_supported: ["header"],
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
