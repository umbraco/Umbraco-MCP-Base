/**
 * Fetch-based API Client for Cloudflare Workers
 *
 * This is the Workers counterpart to client.ts (which uses Axios for stdio mode).
 * Uses native fetch() and returns HttpResponse-compatible objects for use with
 * the SDK's api-call-helpers.
 *
 * Used by the hosted MCP server (worker.ts) - not used in stdio mode.
 */

import type { HttpResponse } from "@umbraco-cms/mcp-server-sdk";
import {
  createUmbracoFetchClient,
  type UmbracoFetchClientConfig,
} from "@umbraco-cms/mcp-hosted";

/**
 * Creates a fetch-based API client for use in Workers.
 *
 * This wraps the hosted package's createUmbracoFetchClient with the
 * same client interface as the Axios-based client (ExampleApiClient).
 *
 * @param config - Configuration with base URL and access token
 * @returns Client function compatible with configureApiClient
 */
export function createWorkerClient(config: UmbracoFetchClientConfig) {
  const fetchClient = createUmbracoFetchClient(config);

  return {
    getItems: (params?: { skip?: number; take?: number }, options?: any) =>
      fetchClient(
        { method: "get", url: "/umbraco/example/api/v1/item", params: params as Record<string, unknown> },
        options
      ),
    getItemById: (id: string, options?: any) =>
      fetchClient(
        { method: "get", url: `/umbraco/example/api/v1/item/${id}` },
        options
      ),
    createItem: (
      data: { name: string; description?: string; isActive?: boolean },
      options?: any
    ) =>
      fetchClient(
        { method: "post", url: "/umbraco/example/api/v1/item", data },
        options
      ),
    updateItem: (
      id: string,
      data: { name: string; description?: string; isActive?: boolean },
      options?: any
    ) =>
      fetchClient(
        { method: "put", url: `/umbraco/example/api/v1/item/${id}`, data },
        options
      ),
    deleteItem: (id: string, options?: any) =>
      fetchClient(
        { method: "delete", url: `/umbraco/example/api/v1/item/${id}` },
        options
      ),
    searchItems: (
      params: { query: string; skip?: number; take?: number },
      options?: any
    ) =>
      fetchClient(
        { method: "get", url: "/umbraco/example/api/v1/item/search", params: params as Record<string, unknown> },
        options
      ),
  };
}
