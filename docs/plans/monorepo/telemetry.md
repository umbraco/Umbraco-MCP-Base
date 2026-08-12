# Telemetry for the Umbraco MCP products

Exploration + recommendation. No telemetry exists in this repo today (`grep -ri telemetry packages template` returns
only unrelated hits: an `input-sanitizer` comment and a demo `analytics` tool collection in the chained-MCP test
fixture).

## 1. What we actually want to know

Three distinct audiences, and they want different things. Conflating them is how telemetry projects end up
collecting a lot and answering nothing.

| Audience | Questions | Needs |
|---|---|---|
| **Product / HQ** | Is anyone using this? Which MCP (dev / editor / forms)? Which tools are dead weight? Which Umbraco majors are live? Which MCP clients (Claude Code, Cursor, Copilot, Codex)? | Aggregate counts, low cardinality, long retention |
| **Engineering / HQ** | What errors do real users hit? Which tools are slow? Are 401/refresh paths failing in the hosted Workers? Which Cloud projects fail OAuth? | Error categories + latency, short retention, alerting |
| **Tool design (the interesting one)** | Do LLMs pick the right tool? How many retries before success? Which tools blow up the context window? | Per-session sequences — the same shape our evals already produce |

That third row is the differentiator. `packages/mcp-server-sdk/src/evals/types.ts` (`AgentTestResult`: `toolCalls`,
`turns`, `tokens`, `cost`, `success`) plus `plugins/umbraco-mcp-skills/skills/discuss-mcp/trace-optimization.md`
already define a diagnostic loop — high turns means unclear descriptions, repeated identical calls means the
response shape is unreadable, and so on. Today that loop only runs on eval scenarios we wrote ourselves.
**If production telemetry emits the same field names, the existing trace-optimization skill starts working on real
usage instead of our guesses.** That's the strongest argument for doing this at all.

Note what we *cannot* see server-side: token counts and turn counts belong to the MCP **client**, not the server.
We can see call sequences and timing within a session; we can infer retries; we cannot see cost. Sequence-level
signal is still most of the value.

## 2. The deployment shapes — feasibility differs sharply

| Shape | Runtime owner | Egress path | Consent situation |
|---|---|---|---|
| **Local stdio** — `@umbraco-cms/mcp-dev` 18.0.2, `umbraco-mcp-editor-cms`, `umbraco-forms-mcp-dev`, scaffolded servers | Customer's dev/editor machine | Would need a new outbound call from a dev's laptop | Hardest. Nothing has been agreed with that user |
| **HQ-hosted Workers** — `*.mcp.umbraco.ai`, `umbraco-cloud-hosted-mcp` | **Us** (umbraco.ai Cloudflare account) | Already in our runtime | Easiest. Our service, our logs — same footing as any SaaS |
| **Customer-hosted Workers** — consumers of `@umbraco-cms/mcp-hosted` | Customer's Cloudflare account | Their infra | Must be opt-in, and should export to *their* sink, not ours |
| **`create-umbraco-mcp-server`** | One-shot CLI | — | npm download counts already answer most of it |
| **Claude Code plugins / skills** | Customer's machine | — | Out of scope; no runtime to hook |

Two consequences:

1. **Start with the hosted Workers.** We own the runtime, the multi-tenant Worker at
   `cms.developer.17.mcp.umbraco.ai/at/<alias>/mcp` serves every Cloud project in a region, and no consent
   mechanism needs inventing. Highest signal per unit of work and per unit of risk.
2. **Local stdio is a separate decision** with a genuine consent problem — see §4.

## 3. How Umbraco does it — two precedents, and they disagree

Worth being explicit that these are *different answers to different questions*, not one house style.

### 3a. CMS telemetry — phone home to HQ

`Umbraco.Infrastructure/BackgroundJobs/Jobs/ReportSiteJob.cs`: a recurring job, `TimeSpan.FromDays(1)`, 5-minute
startup delay, POSTs `TelemetryReportData` to `https://telemetry.umbraco.com/installs/` (debug builds go to
`telemetry.rainbowsrock.net`). Fire and forget — the response is discarded and failures are swallowed at
`LogDebug` so a telemetry outage never pollutes customer logs.

Consent (`Umbraco.Core/Services/MetricsConsentService.cs`, key `UmbracoAnalyticsLevel` in the key-value store,
three levels from `TelemetryLevel.cs`, **defaults to `Detailed`** when unset):

- **Minimal** — anonymised site GUID only
- **Basic** — + CMS version, installed packages
- **Detailed** — + everything from `IDetailedTelemetryProvider` implementations (node counts, OS, DB provider,
  runtime mode, webhook counts, …; keys enumerated in `Constants-Telemetry.cs`)

The extension point is `IDetailedTelemetryProvider.GetInformation()`, fanned in by `UsageInformationService`
(which returns `null` outright unless the level is `Detailed`). **Umbraco Commerce uses exactly this** — per
`18/umbraco-commerce/reference/telemetry.md` it "is connected directly to the CMS telemetry pipeline and runs with
the ReportSiteJob", pulling store/product/order counts through a custom provider, with consent managed from the
same Telemetry Data dashboard. So an add-on reporting to HQ through the existing pipeline is a well-trodden path.

Design notes worth copying regardless of what we build: daily aggregate rather than per-event; a GUID that
identifies an install and nothing else; silent failure; and a dashboard that shows the user the exact payload.

### 3b. Umbraco.AI — deliberately does *not* phone home

The closest analogue to us (per-operation AI/tool activity, cost-bearing, privacy-sensitive) and it makes the
opposite choice: **everything stays on the customer's instance.** Two mechanisms:

**OpenTelemetry** (`18/ai-in-umbraco/concepts/observability.md`) — builds on Microsoft.Extensions.AI, which emits
standard `gen_ai.*` spans and metrics; Umbraco.AI enriches them with CMS context under its own namespace
(`umbraco.ai.profile.id/alias`, `umbraco.ai.entity.id/type`, `umbraco.ai.feature.type/id`, `umbraco.ai.audit.id`,
`umbraco.ai.user.id`), exposed as constants on `AITelemetry.Tags` with source name `"Umbraco.AI"`. The customer
opts in by registering that source in *their* OTel pipeline (Jaeger, App Insights, whatever). **"When
OpenTelemetry is not configured, there is zero overhead"** — the middleware short-circuits before recording.

**Local audit log + rolled-up analytics** (`backoffice/usage-analytics.md`, `management-api/analytics/README.md`,
`reference/models/ai-audit-log.md`) — every operation writes an `AIAuditLog` row (timing, status, error
*category* as an enum, token counts, `TraceId` for correlation), rolled up into hourly/daily aggregates behind
`Umbraco:AI:Analytics` config with `UsageHourlyRetentionDays` (30) / `UsageDailyRetentionDays` (365), surfaced via
six `analytics/usage-*` endpoints and a backoffice dashboard. Privacy is a per-dimension switch:
`IncludeUsageUserDimension`, `IncludeUsageEntityTypeDimension`, `IncludeUsageFeatureTypeDimension` — each
documented as "(privacy consideration)". Prompt/response bodies exist only as `PromptSnapshot` /
`ResponseSnapshot`, "if configured to persist".

Design notes to copy: standard semconv names + own-namespace enrichment; zero overhead when unconfigured; error
*categories* not error messages; retention as config; per-dimension privacy toggles; free-text content only ever
opt-in.

## 4. Recommendation — two layers, and don't blur them

Mirror the Umbraco.AI split, because it maps cleanly onto who owns which runtime.

### Layer 1 — one instrumentation point in the SDK (sink-agnostic)

Add `withTelemetry` to the decorator chain in
`packages/mcp-server-sdk/src/helpers/tool-decorators.ts:withStandardDecorators`. That chain already wraps every
tool in every product (`withErrorHandling → withCursorPagination → withInputSanitization → withDryRun →
withPreExecutionCheck`), and `withErrorHandling` already classifies failures into `ToolValidationError` /
`UmbracoApiError` / HTTP / `Error` / unknown — an error-category taxonomy for free, directly comparable to
Umbraco.AI's `AIAuditLogErrorCategory`.

Emit a normalised event to a **pluggable sink that defaults to a no-op**, so an unconfigured server pays nothing —
the Umbraco.AI "zero overhead" property, and non-negotiable for a stdio process on someone's laptop:

```ts
interface McpToolEvent {
  toolName: string; collection: string; slices: string[];
  outcome: "success" | "validation_error" | "api_error" | "transport_error" | "unknown_error";
  durationMs: number;
  serverName: string; serverVersion: string;          // e.g. @umbraco-cms/mcp-dev 18.0.2
  umbracoMajor?: string;                              // UMBRACO_TARGET_MAJOR
  clientName?: string; clientVersion?: string;        // see below
  sessionId?: string;                                 // hosted only; per-DO
  readOnly: boolean; modes: string[];                 // active filter config
  transport: "stdio" | "http";
}
```

`clientName` / `clientVersion` come free from `@modelcontextprotocol/sdk` 1.26.0:
`server.server.getClientVersion()` returns the `Implementation` from `initialize` (plus
`getClientCapabilities()`). "Which MCP clients do people actually use us from" is one of the most useful product
questions and costs one call.

Name fields to match the OTel MCP / GenAI conventions where they exist (`mcp.method.name`,
`mcp.protocol.version`, `mcp.session.id`, `gen_ai.tool.name`) so an OTel exporter is a mapping and not a rename.
But **keep our own event type** and map at the edge: those `mcp.*` attributes were deprecated in the main semconv
registry and moved to `semantic-conventions-genai`, and the method values are still `Development` status. Don't
couple the SDK's public surface to a spec that's still moving.

Deliberately also worth doing, independent of any sink: **the SDK's fetch client sets no `User-Agent`**
(`packages/mcp-server-sdk/src/http/umbraco-fetch-client.ts` builds headers at :297 and :513 without one). Adding
`umbraco-mcp-dev/18.0.2 (+mcp)` makes MCP traffic attributable in *any* Umbraco or Cloud request log, with no new
data collection, no consent question, and no new egress. Cheapest win available and a prerequisite for §5.

### Layer 2 — sinks, one per deployment shape

**(a) HQ-hosted Workers → Cloudflare Workers Analytics Engine.** Start here. Add an `ANALYTICS` binding to
`HostedMcpEnv` (`packages/hosted-mcp/src/types/env.ts`), render it in the `umbraco-cloud-hosted-mcp` Terraform
module alongside the existing `UMBRACO_CLOUD_ROUTING_ENABLED` var, and `writeDataPoint` from the sink. Limits fit
comfortably: 20 blobs, 20 doubles, 1 index per call, 16 KB total blobs, 96 bytes per index, 250 data points per
Worker invocation — one event per tool call is nowhere near any of those. Query via SQL API for dashboards.

Tenant identity needs care: the Cloud project alias is in the URL (`/at/<alias>/mcp`) and is *not* anonymous —
it's effectively a customer identifier. **Use a keyed hash of the alias as the index/sampling key**, keep the
plaintext alias out of blobs, and treat the mapping as internal. That keeps per-tenant aggregation possible
(useful for support) without building a per-customer activity log by accident.

**(b) Customer-hosted Workers + local stdio → OTel exporter, opt-in, customer's own sink.** Exactly the
Umbraco.AI contract: we ship instrumentation, they point it at their collector. Off by default, zero overhead
when unset, no HQ egress, nothing to consent to. This is also what makes the feature *sellable* rather than
merely tolerated — an agency wants to see which tools their editors' AI is hammering.

**(c) Local stdio → HQ.** The genuinely contentious one. Three options:

1. **Explicit opt-in on first run** (env var / config flag, default off). Honest and safe; realistically yields a
   biased sample of enthusiasts.
2. **Inherit the connected instance's CMS consent level.** The Management API exposes
   `GET /umbraco/management/api/v1/telemetry/level` (`GetTelemetryController`), returning
   `Minimal`/`Basic`/`Detailed`. So the MCP server *can* read the site's existing consent and respect it. Two
   real caveats: the whole telemetry controller is `[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]`,
   so an MCP API user without Settings access gets a 403 — which must be treated as "do not send", never as
   "assume the default". And **the anonymised site GUID is not exposed by the Management API at all**
   (`ISiteIdentifierService` is internal; only `TelemetryService` and `NewsDashboardService` consume it), so we
   cannot correlate with CMS telemetry without either minting our own local install ID or asking the CMS to
   expose the identifier. There's also a fair argument that consent given for "CMS telemetry" doesn't extend to
   a separate npm tool on a developer's machine phoning home — so this is a question for legal/DPO, not one to
   settle in code.
3. **Companion Umbraco package registering an `IDetailedTelemetryProvider`.** The most Umbraco-native answer, and
   the one Commerce validates: MCP usage is counted *server-side* and shipped in the existing daily report, under
   existing consent, visible in the existing dashboard, with zero new egress from anyone's laptop. It depends on
   the CMS being able to attribute requests to an MCP — which is what the `User-Agent` change above enables — and
   on somewhere to count them. That's a CMS-side change and therefore **an RFC through the normal contribution
   process**, not something to land quietly.

My recommendation: **(a) now, (b) next, and put (c) up as a decision with option 3 as the preferred long-term
shape and option 1 as the interim.** Don't ship (c) as a default-on phone-home from a CLI tool.

## 5. What to collect — and what not to

GDPR, Danish context, and the safe default is that an MCP tool call's *arguments* are customer content.

**Collect:** tool name, collection, slice, outcome enum, duration (bucketed), error *category*, MCP server
name/version, Umbraco major, client name/version, transport, active filter config (modes / readOnly), hashed
tenant key (hosted only), session ID (hosted only, per-DO, not durable across sessions).

**Do not collect:** tool arguments or results, content/media names, node IDs or GUIDs, document type aliases,
user names or emails, Umbraco base URLs, Cloud project aliases in plaintext, tokens or credentials, raw error
messages (they routinely embed paths, IDs, and API payloads — `withErrorHandling` currently forwards
`error.message` and ProblemDetails `detail` straight into tool results, so an error-message field would leak by
construction). No `PromptSnapshot` equivalent, in any tier.

Also worth settling early, following Umbraco.AI's lead: retention as configuration rather than a hardcoded
number, and per-dimension privacy toggles so a customer can drop the tenant dimension without losing the whole
feature.

## 6. Suggested sequence

1. **`User-Agent` on the SDK fetch client.** Independently useful, no data collection. Days.
2. **`McpToolEvent` + no-op sink + `withTelemetry` in `withStandardDecorators`.** Zero behaviour change until a
   sink is registered; unit-testable; nothing shipped anywhere.
3. **Analytics Engine sink in `@umbraco-cms/mcp-hosted` + binding in the Terraform module.** First real data, from
   our own runtime. Answers the product questions for the hosted MCPs.
4. **OTel exporter sink** (opt-in, customer's collector). Mirrors Umbraco.AI; becomes a feature, not overhead.
5. **Feed real tool-call sequences into the `discuss-mcp` trace-optimization loop.** The payoff for §1's third row.
6. **Decide the local-stdio question** — legal/DPO input, then RFC if we go the `IDetailedTelemetryProvider` route.

## 7. Open questions

- Is HQ willing to run a second telemetry sink (Analytics Engine in the umbraco.ai account), or must everything
  funnel into `telemetry.umbraco.com`? Analytics Engine is per-event and cheap where the CMS endpoint is a daily
  aggregate — they're not interchangeable.
- Does the hosted MCP have a privacy notice / DPA position today? The multi-tenant Worker already sees Cloud
  project aliases and proxies backoffice API calls, so this may already be settled ground rather than new.
- Do we want per-tenant visibility for support ("project X's MCP is erroring"), or strictly aggregate? That single
  answer decides whether the hashed tenant key exists at all.
- Should the editor MCP be treated differently from the developer MCP? Editor sessions are non-technical end
  users; developer sessions are staff on their own machines. Different consent expectations.

## Sources

- CMS: `Umbraco.Infrastructure/BackgroundJobs/Jobs/ReportSiteJob.cs`, `Umbraco.Core/Services/MetricsConsentService.cs`,
  `Umbraco.Core/Models/TelemetryLevel.cs`, `Umbraco.Core/Telemetry/{TelemetryService.cs,Models/TelemetryReportData.cs}`,
  `Umbraco.Infrastructure/Telemetry/{Interfaces/IDetailedTelemetryProvider.cs,Services/UsageInformationService.cs}`,
  `Umbraco.Core/Constants-Telemetry.cs`, `Umbraco.Cms.Api.Management/Controllers/Telemetry/*`
- Docs: `18/ai-in-umbraco/concepts/observability.md`, `18/ai-in-umbraco/backoffice/usage-analytics.md`,
  `18/ai-in-umbraco/management-api/analytics/README.md`, `18/ai-in-umbraco/reference/models/ai-audit-log.md`,
  `18/umbraco-commerce/reference/telemetry.md`,
  `18/umbraco-cms/model-your-content/content-types-and-structure/backoffice/settings-dashboards.md`
- This repo: `packages/mcp-server-sdk/src/helpers/tool-decorators.ts`,
  `packages/mcp-server-sdk/src/http/umbraco-fetch-client.ts`, `packages/hosted-mcp/src/types/env.ts`,
  `packages/hosted-mcp/src/server/create-server.ts`, `packages/mcp-server-sdk/src/evals/types.ts`,
  `plugins/umbraco-mcp-skills/skills/discuss-mcp/trace-optimization.md`
- External: [OTel MCP attribute registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/mcp/)
  (deprecated, moved to [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)),
  [Workers Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits),
  [Introducing Workers Analytics Engine](https://blog.cloudflare.com/workers-analytics-engine/)
