/**
 * Slice Matcher
 *
 * Utilities for validating slice names.
 */

import { allSliceNames } from "../types/tool-definition.js";

/**
 * Validate slice names against the known slice names.
 * Returns valid and invalid names.
 *
 * @param names - Array of slice names to validate
 * @param validSlices - Optional custom list of valid slices (defaults to allSliceNames)
 */
export function validateSliceNames(
  names: string[],
  validSlices: readonly string[] = allSliceNames
): { valid: string[], invalid: string[] } {
  const validNames = new Set<string>(validSlices);

  return {
    valid: names.filter(n => validNames.has(n)),
    invalid: names.filter(n => !validNames.has(n))
  };
}
