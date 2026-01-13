/**
 * Mock Data Store
 *
 * In-memory data store for mock API responses.
 * Used by MSW handlers to persist data during tests.
 */

import { v4 as uuid } from "uuid";

export interface MockItem {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// In-memory store for mock data
export const mockItems: Map<string, MockItem> = new Map();

/**
 * Initialize the store with sample data.
 * Only initializes if the store is empty.
 */
export function initializeMockData(): void {
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

/**
 * Reset the store to empty state.
 * Call this between tests to ensure isolation.
 */
export function resetStore(): void {
  mockItems.clear();
}

/**
 * Get all items from the store.
 */
export function getItems(): MockItem[] {
  return Array.from(mockItems.values());
}

/**
 * Get an item by ID.
 */
export function getItem(id: string): MockItem | undefined {
  return mockItems.get(id);
}

/**
 * Add an item to the store.
 */
export function addItem(item: MockItem): void {
  mockItems.set(item.id, item);
}

/**
 * Update an item in the store.
 */
export function updateItem(id: string, updates: Partial<MockItem>): MockItem | undefined {
  const item = mockItems.get(id);
  if (!item) return undefined;

  const updated = { ...item, ...updates, updatedAt: new Date().toISOString() };
  mockItems.set(id, updated);
  return updated;
}

/**
 * Delete an item from the store.
 */
export function deleteItem(id: string): boolean {
  return mockItems.delete(id);
}

/**
 * Check if an item exists.
 */
export function hasItem(id: string): boolean {
  return mockItems.has(id);
}

/**
 * Get the total count of items.
 */
export function getItemCount(): number {
  return mockItems.size;
}
