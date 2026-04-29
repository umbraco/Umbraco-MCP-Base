# Umbraco Instance Management

Integration tests run against a real Umbraco instance in `demo-site/`. Sometimes test data cannot be created because the instance needs configuration or code that isn't available through the Management API.

**You CAN and SHOULD modify the Umbraco instance when tests require it.** You control the instance. If a builder or test fails because the instance lacks infrastructure, fix the instance — don't skip the test or write workarounds. Writing C# code, adding packages, or changing configuration in the instance is completely fine if it makes tests pass.

## When to Modify the Instance

**DO modify the instance when:**
- A builder's `create()` fails with errors about missing configuration (unconfigured providers, missing settings)
- An API returns errors indicating an unconfigured feature
- A feature requires a specific type/provider that doesn't exist yet
- The error is infrastructure-level, not a code bug

**Do NOT modify the instance when:**
- The error is a code bug in your builder, helper, or test
- The API returns validation errors about bad input data (wrong field types, missing required fields)
- The test logic itself is wrong

## How to Modify the Instance

Read the port from `.env` `UMBRACO_BASE_URL` (e.g., `https://localhost:44365` → `44365`).

| Step | Command | Purpose |
|------|---------|---------|
| Make changes | Edit `demo-site/appsettings.json` | Change settings |
| | `dotnet add demo-site package <Name>` | Add NuGet packages |
| | Add `.cs` files to `demo-site/` | Custom providers, types, extensions |
| Stop instance | `pkill -f 'dotnet.*demo-site'` | Kill the running process |
| Rebuild | `dotnet build demo-site` | Compile with changes |
| Restart | `dotnet run --project demo-site > /dev/null 2>&1 &` | Start in background |
| Wait for ready | `curl -sk https://localhost:<PORT>/umbraco/management/api/v1/health-check-group` | Poll until it responds |
| Retry | Run the failing test again | |

## Concrete Examples

### Example 1: Umbraco Forms Data Sources — add a simple test-friendly type

**Problem:** The built-in "SQL Database" data source type validates a real database connection at creation time. This makes it hard to test data source CRUD operations.

**Simplest fix:** Create a minimal C# data source type in `demo-site/` that has no external dependencies:

```csharp
// demo-site/TestDataSourceType.cs
using Umbraco.Forms.Core;
using Umbraco.Forms.Core.Providers;

public class TestDataSourceType : DataSourceType
{
    public TestDataSourceType()
    {
        Id = new Guid("12345678-0000-0000-0000-000000000001");
        Name = "Test Data Source";
        Description = "Simple data source for integration testing";
    }

    public override List<Exception> ValidateSettings() => new();
    public override List<DataSourceField> GetFields() => new();
}
```

Rebuild and restart. The builder can now create data sources of this type with no external infrastructure needed.

### Example 2: Package settings required in appsettings

**Problem:** A package feature requires specific configuration to be present in `appsettings.json` before its API endpoints work.

**Fix:** Read the package documentation or error messages to identify what settings are needed, then add them:

```json
{
  "Umbraco": {
    "Forms": {
      "Security": {
        "ManageSecurityWithUserGroups": true
      }
    }
  }
}
```

### Example 4: Missing NuGet package

**Problem:** Tests need an API that belongs to a package not installed in the instance.

**Fix:**

```bash
pkill -f 'dotnet.*demo-site' 2>/dev/null
dotnet add demo-site package Umbraco.Forms.Deploy
dotnet build demo-site
dotnet run --project demo-site > /dev/null 2>&1 &
```

## Critical Rules

**NEVER INVENT EXTERNAL DEPENDENCIES.** Do not fabricate database credentials, server addresses, connection strings, or external services. When a feature needs a provider or type, create a minimal test-friendly one in C# — don't conjure up infrastructure that doesn't exist.

**USE THE GENERATED CLIENT, NOT CURL.** Never use curl to call APIs or fetch swagger specs. When you need to explore the API (list available types, check what's configured, understand operations), read the Orval-generated client in `src/umbraco-api/api/generated/` — it already has every operation typed. To call APIs at runtime, use the generated client functions — they handle authentication automatically. To understand the API structure, use the Read tool on the generated files or the swagger spec URL from `orval.config.ts`.

**ALWAYS MODIFY THE INSTANCE, NEVER HACK THE API.** Don't try to bypass the instance by calling APIs directly with curl, inventing request payloads, or fabricating data. If an API requires configuration, configure the instance properly — add the C# code or settings, rebuild, restart. The API should then accept normal requests through the builders.

**PREFER THE SIMPLEST OPTION.** Always go for the easiest fix first. If you can add a simple C# class that avoids the need for external config entirely, do that. For example, a test-friendly Forms data source type with no settings validation is simpler than configuring external infrastructure. Only escalate to configuration changes if a simpler code-based solution isn't possible.

**KEEP CHANGES MINIMAL.** Only change what's needed to unblock the test. Don't restructure the instance, add unnecessary packages, or over-engineer the solution.

## Important Notes

- Read `UMBRACO_BASE_URL` from `.env` to get the correct host and port
- After restarting, always wait for the health endpoint before running tests
- If `dotnet build` fails, read the error — you may need to fix the C# code you added
- The instance runs in the background; check `lsof -ti :<PORT>` to verify it's up
- C# files added to `demo-site/` are automatically compiled — no registration needed for simple types that use attribute-based discovery
- For types that need explicit registration, modify `demo-site/Program.cs`
