/**
 * Hex Encoding
 *
 * One place for byte-to-hex, so `generateSecureRandom` (auth/umbraco-handler.ts)
 * and the telemetry hashing helpers (telemetry/request-telemetry.ts) don't
 * each maintain their own copy of the same primitive.
 */

/** Lower-case hex encoding of a byte sequence, no separators. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
