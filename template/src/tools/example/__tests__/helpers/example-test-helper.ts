/**
 * Example Test Helper
 *
 * Provides utility methods for working with example items in tests.
 * Includes cleanup, search, and data normalization functions.
 *
 * Usage:
 * ```typescript
 * // Clean up test items after tests
 * afterEach(async () => {
 *   await ExampleTestHelper.cleanup("_Test");
 * });
 *
 * // Find an item by name
 * const item = await ExampleTestHelper.findByName("Test Item");
 *
 * // Normalize IDs for snapshot testing
 * const normalized = ExampleTestHelper.normalizeIds(data);
 * ```
 */

import { getClient } from "../../../../api/client.js";

// Interface for example item from API
interface ExampleItem {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Helper class for example item testing operations
 */
export class ExampleTestHelper {
  /**
   * Find an example item by name
   *
   * @param name - The exact name to search for
   * @returns The item if found, undefined otherwise
   */
  static async findByName(name: string): Promise<ExampleItem | undefined> {
    const client = getClient();
    // Without returnFullResponse, customInstance returns data directly
    const response: any = await client.getItems({ skip: 0, take: 100 });

    const data = response as { items: ExampleItem[] };
    return data.items.find((item) => item.name === name);
  }

  /**
   * Find an example item by ID
   *
   * @param id - The item ID
   * @returns The item if found, undefined otherwise
   */
  static async findById(id: string): Promise<ExampleItem | undefined> {
    const client = getClient();

    try {
      const response: any = await client.getItemById(id);
      return response as ExampleItem;
    } catch {
      return undefined;
    }
  }

  /**
   * Search for items matching a query
   *
   * @param query - The search query
   * @param options - Optional pagination parameters
   * @returns Array of matching items
   */
  static async search(
    query: string,
    options: { skip?: number; take?: number } = {}
  ): Promise<ExampleItem[]> {
    const client = getClient();
    const response: any = await client.searchItems({
      query,
      skip: options.skip ?? 0,
      take: options.take ?? 100,
    });

    const data = response as { items: ExampleItem[] };
    return data.items;
  }

  /**
   * List all items with pagination
   *
   * @param options - Optional pagination parameters
   * @returns Object with total count and items array
   */
  static async list(
    options: { skip?: number; take?: number } = {}
  ): Promise<{ total: number; items: ExampleItem[] }> {
    const client = getClient();
    const response: any = await client.getItems({
      skip: options.skip ?? 0,
      take: options.take ?? 100,
    });

    return response as { total: number; items: ExampleItem[] };
  }

  /**
   * Clean up test items by name prefix
   *
   * Deletes all items whose names start with the given prefix.
   * Useful for cleaning up after tests.
   * Silently ignores errors during deletion.
   *
   * @param namePrefix - Delete items starting with this prefix
   */
  static async cleanup(namePrefix: string): Promise<void> {
    const client = getClient();

    try {
      const response: any = await client.getItems({ skip: 0, take: 100 });
      const data = response as { items: ExampleItem[] };

      const toDelete = data.items.filter((item) =>
        item.name.startsWith(namePrefix)
      );

      for (const item of toDelete) {
        try {
          await client.deleteItem(item.id);
        } catch {
          // Ignore errors during cleanup
          // Items may have already been deleted or may not exist
        }
      }
    } catch {
      // Ignore errors during cleanup list operation
    }
  }

  /**
   * Delete a specific item by ID
   *
   * @param id - The item ID to delete
   */
  static async deleteById(id: string): Promise<void> {
    const client = getClient();
    await client.deleteItem(id);
  }

  /**
   * Normalize IDs in data for snapshot testing
   *
   * Replaces all UUID IDs with a zero UUID to make snapshots consistent.
   * Handles nested objects and arrays recursively.
   *
   * @param data - The data to normalize (any type)
   * @returns A copy of the data with normalized IDs
   */
  static normalizeIds(data: any): any {
    if (Array.isArray(data)) {
      return data.map((item) => this.normalizeIds(item));
    }

    if (data && typeof data === "object") {
      const normalized = { ...data };

      // Normalize the id field if present
      if (normalized.id && typeof normalized.id === "string") {
        normalized.id = "00000000-0000-0000-0000-000000000000";
      }

      // Recursively normalize nested objects
      for (const key of Object.keys(normalized)) {
        if (typeof normalized[key] === "object" && normalized[key] !== null) {
          normalized[key] = this.normalizeIds(normalized[key]);
        }
      }

      return normalized;
    }

    return data;
  }

  /**
   * Normalize timestamps in data for snapshot testing
   *
   * Replaces createdAt and updatedAt timestamps with fixed values.
   * Useful for consistent snapshot tests.
   *
   * @param data - The data to normalize
   * @returns A copy of the data with normalized timestamps
   */
  static normalizeTimestamps(data: any): any {
    if (Array.isArray(data)) {
      return data.map((item) => this.normalizeTimestamps(item));
    }

    if (data && typeof data === "object") {
      const normalized = { ...data };

      // Normalize timestamp fields
      if (normalized.createdAt) {
        normalized.createdAt = "2024-01-01T00:00:00.000Z";
      }
      if (normalized.updatedAt) {
        normalized.updatedAt = "2024-01-01T00:00:00.000Z";
      }

      // Recursively normalize nested objects
      for (const key of Object.keys(normalized)) {
        if (typeof normalized[key] === "object" && normalized[key] !== null) {
          normalized[key] = this.normalizeTimestamps(normalized[key]);
        }
      }

      return normalized;
    }

    return data;
  }

  /**
   * Normalize all fields for snapshot testing
   *
   * Combines ID and timestamp normalization.
   *
   * @param data - The data to normalize
   * @returns A copy of the data with all fields normalized
   */
  static normalizeForSnapshot(data: any): any {
    return this.normalizeTimestamps(this.normalizeIds(data));
  }
}
