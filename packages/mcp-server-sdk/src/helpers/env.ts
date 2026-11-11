/**
 * Reads a boolean flag straight from the process environment, for hosts that
 * never resolve config through getServerConfig() (e.g. Workers, tests).
 * "true" and "1" enable it (case-insensitive); anything else, or no `process`, is false.
 */
export function readBooleanEnv(name: string): boolean {
  const value = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}
