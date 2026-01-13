/**
 * Slice Matcher
 *
 * Utilities for validating slice names.
 */

import { allBaseSliceNames } from "../types/tool-definition.js";

/**
 * Validate slice names against the known slice names.
 * Returns valid and invalid names.
 *
 * @param names - Array of slice names to validate
 * @param validSlices - Custom list of valid slices (required - pass your project's allSliceNames)
 */
export function validateSliceNames(
  names: string[],
  validSlices: readonly string[] = allBaseSliceNames
): { valid: string[], invalid: string[] } {
  const validNames = new Set<string>(validSlices);

  return {
    valid: names.filter(n => validNames.has(n)),
    invalid: names.filter(n => !validNames.has(n))
  };
}
