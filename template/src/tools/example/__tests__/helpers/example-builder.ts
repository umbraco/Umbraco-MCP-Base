/**
 * Example Item Builder
 *
 * Fluent builder for creating example items in tests.
 * Provides a consistent way to create test data with sensible defaults.
 *
 * Usage:
 * ```typescript
 * const builder = await new ExampleBuilder()
 *   .withName("Test Item")
 *   .withDescription("Test description")
 *   .create();
 *
 * const id = builder.getId();
 * ```
 */

import { z } from "zod";
import { createItemBody } from "../../../../api/generated/exampleApi.zod.js";
import { getClient } from "../../../../api/client.js";

// Test constant for default naming
const TEST_EXAMPLE_NAME = "_Test Example";

// Model interface matching the API schema
interface ExampleItemModel {
  name: string;
  description?: string | null;
  isActive?: boolean;
}

// Response interface for created items
interface ExampleItemResponse {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Builder for creating example items in tests.
 * Uses fluent interface pattern for easy test data construction.
 */
export class ExampleBuilder {
  private model: ExampleItemModel = {
    name: TEST_EXAMPLE_NAME,
    isActive: true,
  };

  private createdId?: string;
  private createdItem?: ExampleItemResponse;

  /**
   * Set the item name
   */
  withName(name: string): this {
    this.model.name = name;
    return this;
  }

  /**
   * Set the item description
   */
  withDescription(description: string | null): this {
    this.model.description = description;
    return this;
  }

  /**
   * Set whether the item is active
   */
  withIsActive(isActive: boolean): this {
    this.model.isActive = isActive;
    return this;
  }

  /**
   * Build the model without creating it
   * Useful for testing validation or preparing data
   */
  build(): ExampleItemModel {
    return { ...this.model };
  }

  /**
   * Create the item via the API
   * Validates the model and stores the created ID
   */
  async create(): Promise<this> {
    // Validate with Zod schema and convert null to undefined for API
    const validated = createItemBody.parse(this.model);
    const payload = {
      ...validated,
      description: validated.description === null ? undefined : validated.description,
    };

    // Call API to create
    const client = getClient();
    // Note: customInstance returns AxiosResponse type but actually returns data when returnFullResponse is not set
    // We use returnFullResponse to get the full response with headers
    const response: any = await client.createItem(payload, {
      returnFullResponse: true,
    } as any);

    // Check for success (201 Created)
    if (response.status !== 201) {
      throw new Error(
        `Failed to create example item: ${response.status} ${response.statusText || ""}`
      );
    }

    // Extract ID from Location header
    const location = response.headers?.Location || response.headers?.location;
    if (!location) {
      throw new Error("No Location header in create response");
    }

    this.createdId = location.split("/").pop();
    if (!this.createdId) {
      throw new Error("Could not extract ID from Location header");
    }

    // Fetch the created item to store full details
    try {
      // Without returnFullResponse, it returns the data directly
      const getResponse: any = await client.getItemById(this.createdId);
      this.createdItem = getResponse as ExampleItemResponse;
    } catch {
      // If we can't fetch it, that's okay - we have the ID
    }

    return this;
  }

  /**
   * Get the ID of the created item
   * @throws Error if create() has not been called yet
   */
  getId(): string {
    if (!this.createdId) {
      throw new Error(
        "Example item not created yet. Call create() first."
      );
    }
    return this.createdId;
  }

  /**
   * Get the full created item details
   * Returns undefined if create() hasn't been called or item fetch failed
   */
  getCreatedItem(): ExampleItemResponse | undefined {
    return this.createdItem;
  }

  /**
   * Get the built model
   * Returns the model that was used to create the item
   */
  getItem(): ExampleItemModel {
    return this.build();
  }
}

/**
 * Export the test constant for use in other tests
 */
export { TEST_EXAMPLE_NAME };
