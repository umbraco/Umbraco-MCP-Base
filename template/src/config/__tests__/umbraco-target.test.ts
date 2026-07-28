import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { UMBRACO_TARGET_MAJOR } from "../umbraco-target.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("UMBRACO_TARGET_MAJOR", () => {
  it("matches the Umbraco.Cms major pinned in tests/umbraco-instance/TestUmbraco.csproj", () => {
    const csprojPath = path.resolve(
      __dirname,
      "../../../../tests/umbraco-instance/TestUmbraco.csproj",
    );
    const csproj = readFileSync(csprojPath, "utf-8");
    const match = csproj.match(/<PackageReference Include="Umbraco\.Cms" Version="(\d+)\.[\d.]+"/);

    expect(match).not.toBeNull();
    expect(UMBRACO_TARGET_MAJOR).toBe(match?.[1]);
  });
});
