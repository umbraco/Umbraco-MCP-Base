/**
 * API Client Configuration
 *
 * This file sets up the Axios instance used by generated API code.
 *
 * Features:
 * - Mock mode for development/testing (set USE_MOCK_API=true)
 * - OAuth authentication for real API calls
 * - Full response support for API helpers (returnFullResponse option)
 */

import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { v4 as uuid } from "uuid";

// Configuration from environment (read at runtime to support test mocking)
const getBaseUrl = () => process.env.UMBRACO_BASE_URL || "http://localhost:44391";
const getClientId = () => process.env.UMBRACO_CLIENT_ID || "";
const getClientSecret = () => process.env.UMBRACO_CLIENT_SECRET || "";
const isMockMode = () => process.env.USE_MOCK_API === "true";

// ============================================================================
// Mock Data Store
// ============================================================================

interface MockItem {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// In-memory store for mock data
const mockItems: Map<string, MockItem> = new Map();

// Initialize with some sample data
function initializeMockData() {
  if (mockItems.size === 0) {
    const sampleItems: Omit<MockItem, "id" | "createdAt" | "updatedAt">[] = [
      { name: "Sample Item 1", description: "First sample item", isActive: true },
      { name: "Sample Item 2", description: "Second sample item", isActive: true },
      { name: "Inactive Item", description: "This item is inactive", isActive: false },
    ];

    sampleItems.forEach((item) => {
      const id = uuid();
      const now = new Date().toISOString();
      mockItems.set(id, {
        ...item,
        id,
        createdAt: now,
        updatedAt: now,
      });
    });
  }
}

// ============================================================================
// Mock API Handlers
// ============================================================================

function handleMockRequest<T>(config: AxiosRequestConfig): AxiosResponse<T> {
  initializeMockData();

  const { method: rawMethod, url, data } = config;
  // Normalize method to lowercase for consistent matching
  const method = rawMethod?.toLowerCase();
  // Handle paths from both generated client (/item) and getClient() (/umbraco/example/api/v1/item)
  const rawPath = url || "";
  const path = rawPath.replace(/^\/umbraco\/example\/api\/v1/, "");

  // GET /item - List all items
  if (method === "get" && path === "/item") {
    const params = config.params || {};
    const skip = parseInt(params.skip) || 0;
    const take = parseInt(params.take) || 100;
    const items = Array.from(mockItems.values()).slice(skip, skip + take);

    return createMockResponse(200, {
      total: mockItems.size,
      items,
    } as T);
  }

  // GET /item/search - Search items
  if (method === "get" && path === "/item/search") {
    const params = config.params || {};
    const query = (params.query || "").toLowerCase();
    const skip = parseInt(params.skip) || 0;
    const take = parseInt(params.take) || 100;

    const filtered = Array.from(mockItems.values()).filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query)
    );

    return createMockResponse(200, {
      total: filtered.length,
      items: filtered.slice(skip, skip + take),
    } as T);
  }

  // GET /item/:id - Get single item
  const getItemMatch = path.match(/^\/item\/([a-f0-9-]+)$/i);
  if (method === "get" && getItemMatch) {
    const id = getItemMatch[1];
    const item = mockItems.get(id);

    if (!item) {
      return createMockResponse(404, {
        type: "https://tools.ietf.org/html/rfc7231#section-6.5.4",
        title: "Not Found",
        status: 404,
        detail: `Item with id '${id}' not found`,
      } as T);
    }

    return createMockResponse(200, item as T);
  }

  // POST /item - Create item
  if (method === "post" && path === "/item") {
    const body = typeof data === "string" ? JSON.parse(data) : data;
    const id = uuid();
    const now = new Date().toISOString();

    const newItem: MockItem = {
      id,
      name: body.name,
      description: body.description || null,
      isActive: body.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    mockItems.set(id, newItem);

    return createMockResponse(201, undefined as T, {
      Location: `/item/${id}`,
    });
  }

  // PUT /item/:id - Update item
  const updateItemMatch = path.match(/^\/item\/([a-f0-9-]+)$/i);
  if (method === "put" && updateItemMatch) {
    const id = updateItemMatch[1];
    const item = mockItems.get(id);

    if (!item) {
      return createMockResponse(404, {
        type: "https://tools.ietf.org/html/rfc7231#section-6.5.4",
        title: "Not Found",
        status: 404,
        detail: `Item with id '${id}' not found`,
      } as T);
    }

    const body = typeof data === "string" ? JSON.parse(data) : data;
    const updatedItem: MockItem = {
      ...item,
      name: body.name,
      description: body.description ?? item.description,
      isActive: body.isActive ?? item.isActive,
      updatedAt: new Date().toISOString(),
    };

    mockItems.set(id, updatedItem);

    return createMockResponse(200, undefined as T);
  }

  // DELETE /item/:id - Delete item
  const deleteItemMatch = path.match(/^\/item\/([a-f0-9-]+)$/i);
  if (method === "delete" && deleteItemMatch) {
    const id = deleteItemMatch[1];

    if (!mockItems.has(id)) {
      return createMockResponse(404, {
        type: "https://tools.ietf.org/html/rfc7231#section-6.5.4",
        title: "Not Found",
        status: 404,
        detail: `Item with id '${id}' not found`,
      } as T);
    }

    mockItems.delete(id);

    return createMockResponse(200, undefined as T);
  }

  // Unknown endpoint
  return createMockResponse(404, {
    type: "https://tools.ietf.org/html/rfc7231#section-6.5.4",
    title: "Not Found",
    status: 404,
    detail: `Endpoint not found: ${method?.toUpperCase()} ${path}`,
  } as T);
}

function createMockResponse<T>(
  status: number,
  data: T,
  headers: Record<string, string> = {}
): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: status === 200 ? "OK" : status === 201 ? "Created" : "Error",
    headers,
    config: {} as any,
  };
}

// ============================================================================
// Real API Authentication
// ============================================================================

let accessToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Gets an OAuth access token from Umbraco.
 */
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 30 second buffer)
  if (accessToken && Date.now() < tokenExpiry - 30000) {
    return accessToken;
  }

  const tokenUrl = `${getBaseUrl()}/umbraco/management/api/v1/security/back-office/token`;

  const response = await axios.post(
    tokenUrl,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: getClientId(),
      client_secret: getClientSecret(),
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  accessToken = response.data.access_token;
  tokenExpiry = Date.now() + response.data.expires_in * 1000;

  return accessToken!;
}

// ============================================================================
// Main Client Instance
// ============================================================================

/**
 * Custom Axios instance for API calls.
 * Used by Orval-generated code.
 *
 * Set USE_MOCK_API=true to use mock data instead of real API.
 */
export const customInstance = async <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig
): Promise<AxiosResponse<T>> => {
  const mergedConfig = { ...config, ...options };
  const returnFullResponse = (mergedConfig as any).returnFullResponse === true;

  // Use mock mode if enabled (check at runtime to support test mocking)
  if (isMockMode()) {
    const response = handleMockRequest<T>(mergedConfig);

    // Throw on error status codes (like real Axios does) unless returnFullResponse is set
    if (!returnFullResponse && response.status >= 400) {
      const error: any = new Error(`Request failed with status code ${response.status}`);
      error.response = response;
      error.status = response.status;
      throw error;
    }

    if (returnFullResponse) {
      return response;
    }
    return response.data as any;
  }

  // Real API mode
  const token = await getAccessToken();

  const instance = axios.create({
    baseURL: getBaseUrl(),
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (returnFullResponse && !mergedConfig.validateStatus) {
    mergedConfig.validateStatus = () => true;
  }

  const response = await instance.request<T>({
    ...mergedConfig,
  });

  if (returnFullResponse) {
    return response;
  }

  return response.data as any;
};

export default customInstance;

// ============================================================================
// Helper Constants for API Calls
// ============================================================================

/**
 * Pass this as the options parameter to capture the full HTTP response
 * instead of just the response data.
 */
export const CAPTURE_RAW_HTTP_RESPONSE = { returnFullResponse: true };

// ============================================================================
// Client Singleton for API Helpers
// ============================================================================

/**
 * API client interface matching the generated client structure.
 * This is used by the toolkit's API helpers.
 */
export interface ExampleApiClient {
  getItems: (params?: { skip?: number; take?: number }, options?: any) => Promise<any>;
  getItemById: (id: string, options?: any) => Promise<any>;
  createItem: (data: { name: string; description?: string; isActive?: boolean }, options?: any) => Promise<any>;
  updateItem: (id: string, data: { name: string; description?: string; isActive?: boolean }, options?: any) => Promise<any>;
  deleteItem: (id: string, options?: any) => Promise<any>;
  searchItems: (params: { query: string; skip?: number; take?: number }, options?: any) => Promise<any>;
}

// Singleton client instance
let clientInstance: ExampleApiClient | null = null;

/**
 * Gets the API client instance.
 * Creates the client on first call.
 */
export function getClient(): ExampleApiClient {
  if (!clientInstance) {
    clientInstance = {
      getItems: (params, options) =>
        customInstance({ method: "get", url: "/umbraco/example/api/v1/item", params }, options),
      getItemById: (id, options) =>
        customInstance({ method: "get", url: `/umbraco/example/api/v1/item/${id}` }, options),
      createItem: (data, options) =>
        customInstance({ method: "post", url: "/umbraco/example/api/v1/item", data }, options),
      updateItem: (id, data, options) =>
        customInstance({ method: "put", url: `/umbraco/example/api/v1/item/${id}`, data }, options),
      deleteItem: (id, options) =>
        customInstance({ method: "delete", url: `/umbraco/example/api/v1/item/${id}` }, options),
      searchItems: (params, options) =>
        customInstance({ method: "get", url: "/umbraco/example/api/v1/item/search", params }, options),
    };
  }
  return clientInstance;
}

/**
 * Example API client class for use with toolkit's configureApiClient.
 */
export const ExampleApiClient = {
  getClient,
};
