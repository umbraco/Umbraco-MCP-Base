/**
 * The Umbraco major version this scaffolded server targets.
 *
 * Used as the default for `expectedUmbracoMajor` (see `server-config.ts`) so
 * the version-compatibility check works out of the box instead of requiring
 * every user to discover and set `UMBRACO_EXPECTED_MAJOR` themselves.
 * `UMBRACO_EXPECTED_MAJOR` / `--umbraco-expected-major` still override this
 * when a project deliberately targets a different Umbraco major.
 *
 * Kept in sync with `tests/umbraco-instance/TestUmbraco.csproj`'s
 * `Umbraco.Cms` package major — see `__tests__/umbraco-target.test.ts`, which
 * fails CI if the two drift apart.
 */
export const UMBRACO_TARGET_MAJOR = "17";
