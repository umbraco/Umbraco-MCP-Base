/**
 * Extracts the leading numeric component of a version string.
 *
 * Shared by the orval target-major transformer (deriving a spec's or a
 * connected instance's major at generation time) and `checkUmbracoVersion`
 * (parsing the connected instance's reported version at runtime), so the two
 * answer "what's the major of this version string" the same way.
 */
export function majorFromVersion(version: unknown): string | null {
  if (typeof version !== "string") return null;

  // "17.4.0" → "17", "17" → "17", " 18.0.0-rc1 " → "18", "Latest" → null.
  const match = version.trim().match(/^(\d+)/);
  return match ? match[1] : null;
}
