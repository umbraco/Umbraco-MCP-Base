/**
 * MSW Request Handlers
 *
 * Defines mock API handlers using MSW (Mock Service Worker).
 * These handlers intercept HTTP requests and return mock responses.
 */

import { http, HttpResponse } from "msw";
import { v4 as uuid } from "uuid";
import {
  initializeMockData,
  mockItems,
  getItem,
  addItem,
  deleteItem,
  hasItem,
  getItemCount,
  type MockItem,
} from "./store.js";

// Base path for the API (matches the generated client URLs)
const API_BASE = "*";

/**
 * Create a ProblemDetails error response (RFC 7807)
 */
function problemDetails(status: number, title: string, detail: string) {
  return HttpResponse.json(
    {
      type: "https://tools.ietf.org/html/rfc7231#section-6.5.4",
      title,
      status,
      detail,
    },
    { status }
  );
}

export const handlers = [
  // OAuth token endpoint - returns a mock token for tests
  http.post("*/umbraco/management/api/v1/security/back-office/token", () => {
    return HttpResponse.json({
      access_token: "mock-access-token",
      token_type: "Bearer",
      expires_in: 3600,
    });
  }),

  // GET /item - List all items
  http.get(`${API_BASE}/item`, ({ request }) => {
    initializeMockData();

    const url = new URL(request.url);
    const skip = parseInt(url.searchParams.get("skip") || "0");
    const take = parseInt(url.searchParams.get("take") || "100");

    const items = Array.from(mockItems.values()).slice(skip, skip + take);

    return HttpResponse.json({
      total: getItemCount(),
      items,
    });
  }),

  // GET /item/search - Search items
  http.get(`${API_BASE}/item/search`, ({ request }) => {
    initializeMockData();

    const url = new URL(request.url);
    const query = (url.searchParams.get("query") || "").toLowerCase();
    const skip = parseInt(url.searchParams.get("skip") || "0");
    const take = parseInt(url.searchParams.get("take") || "100");

    const filtered = Array.from(mockItems.values()).filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query)
    );

    return HttpResponse.json({
      total: filtered.length,
      items: filtered.slice(skip, skip + take),
    });
  }),

  // GET /item/:id - Get single item
  http.get(`${API_BASE}/item/:id`, ({ params }) => {
    initializeMockData();

    const id = params.id as string;
    const item = getItem(id);

    if (!item) {
      return problemDetails(404, "Not Found", `Item with id '${id}' not found`);
    }

    return HttpResponse.json(item);
  }),

  // POST /item - Create item
  http.post(`${API_BASE}/item`, async ({ request }) => {
    initializeMockData();

    const body = (await request.json()) as {
      name: string;
      description?: string;
      isActive?: boolean;
    };

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

    addItem(newItem);

    return new HttpResponse(null, {
      status: 201,
      headers: {
        Location: `/item/${id}`,
      },
    });
  }),

  // PUT /item/:id - Update item
  http.put(`${API_BASE}/item/:id`, async ({ params, request }) => {
    initializeMockData();

    const id = params.id as string;
    const item = getItem(id);

    if (!item) {
      return problemDetails(404, "Not Found", `Item with id '${id}' not found`);
    }

    const body = (await request.json()) as {
      name: string;
      description?: string;
      isActive?: boolean;
    };

    const updatedItem: MockItem = {
      ...item,
      name: body.name,
      description: body.description ?? item.description,
      isActive: body.isActive ?? item.isActive,
      updatedAt: new Date().toISOString(),
    };

    mockItems.set(id, updatedItem);

    return new HttpResponse(null, { status: 200 });
  }),

  // DELETE /item/:id - Delete item
  http.delete(`${API_BASE}/item/:id`, ({ params }) => {
    initializeMockData();

    const id = params.id as string;

    if (!hasItem(id)) {
      return problemDetails(404, "Not Found", `Item with id '${id}' not found`);
    }

    deleteItem(id);

    return new HttpResponse(null, { status: 200 });
  }),
];
