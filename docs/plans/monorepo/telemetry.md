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
2. **Local stdio ships later, not never.** The §4 decision (OTel only, no phone-home) removes the consent problem
   that made this the hard case — what's left is a Node OTel adapter, pointed at a collector the customer owns.

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

### Layer 2 — one sink: OpenTelemetry

**Decision taken: OTel everywhere. No phone-home, in any product.** We do not report MCP usage back to HQ
through the CMS telemetry pipeline, we do not add an `IDetailedTelemetryProvider`, and we do not read the
connected instance's consent level in order to send anything. Spans go to a collector, and who owns that
collector follows who owns the runtime:

| Deployment | Collector owner | Consent needed |
|---|---|---|
| HQ-hosted Workers (`*.mcp.umbraco.ai`) | HQ — our runtime, our destination | None new (our service) |
| Customer-hosted Workers | The customer | None (their data, their sink) |
| Local stdio | The customer, opt-in | None (their data, their sink) |

This is the Umbraco.AI contract applied across the board: we ship instrumentation, the operator points it at a
collector, and when none is configured there is zero overhead. It also makes the feature *sellable* rather than
merely tolerated — an agency wants to see which tools their editors' AI is hammering.

The implementation plan for the HQ-hosted Workers is `docs/plans/hosted-mcp/otel-tracing.md`; the spike there
confirms the mechanism works. Because Cloudflare's native tracing is what the hosted Workers use, the
customer-hosted case comes free — same adapter, they just name their own destination.

**What this decision costs, stated plainly:** if nothing phones home, **HQ gets no telemetry from local stdio
installs at all.** Those are public npm packages (`@umbraco-cms/mcp-dev`, `umbraco-mcp-editor-cms`,
`umbraco-forms-mcp-dev`) and may well be where most usage lives. Our adoption signal there reduces to npm
download counts, plus whatever a customer volunteers. We will have good data about the hosted Workers and near
none about the local ones. That's an acceptable trade if the alternative is a CLI tool on a developer's machine
opening an outbound connection they didn't ask for — but it should be a known blind spot, not a surprise later
when someone asks how many people use the dev MCP.

**Consequence for reporting:** with the CMS pipeline out and Analytics Engine no longer in the plan, durable
usage counts have to come from **span-derived metrics in the backend** (an OTel Collector's span metrics
connector, or Grafana Cloud's Tempo metrics-generator). That makes the backend choice load-bearing: a tracing
store with 7-day retention and no span→metrics capability will answer "why did this call fail" and *not* "which
tools were used last quarter". See `otel-tracing.md` §12.

### Rejected: the CMS telemetry pipeline

Recorded because it was the obvious candidate and Commerce validates it, so it will be asked about again.

Reporting through `ReportSiteJob` would have meant a companion Umbraco package registering an
`IDetailedTelemetryProvider` — MCP usage counted server-side, shipped in the existing daily report, under
existing consent, visible in the existing dashboard, with zero new egress from anyone's laptop. Genuinely the
most Umbraco-native answer.

Ruled out because it buys HQ data at a poor price:

- It requires a CMS-side change and therefore an RFC through the normal contribution process, plus the CMS being
  able to attribute inbound requests to an MCP at all.
- The consent story is muddy: `GET /umbraco/management/api/v1/telemetry/level` exists
  (`GetTelemetryController`) but is gated on `SectionAccessSettings`, so an MCP API user without Settings access
  gets a 403; and the anonymised site GUID is not exposed by the Management API at all
  (`ISiteIdentifierService` is internal), so we couldn't correlate with CMS telemetry without minting our own
  install ID or asking the CMS to expose the identifier.
- It only ever served the phone-home use case. It does nothing for the customer, whereas OTel gives them
  something they'd actually want.

The `User-Agent` change above was partly motivated as a prerequisite for this route. **Keep it anyway** — making
MCP traffic attributable in any Umbraco or Cloud request log is independently useful for support and debugging,
and costs nothing.

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
2. **`TelemetryAdapter` + `withTelemetry` in `withStandardDecorators`.** Zero behaviour change until an adapter is
   registered; unit-testable; nothing shipped anywhere.
3. **Cloudflare tracing adapter in `@umbraco-cms/mcp-hosted`**, plus the destination and Wrangler template wiring.
   First real data, from our own runtime — and the same adapter serves customer-hosted Workers. Detail in
   `docs/plans/hosted-mcp/otel-tracing.md`.
4. **Node OTel adapter for local stdio** (opt-in, customer's collector). Needs force-flush on process exit; see
   `otel-tracing.md` §13.
5. **Feed real tool-call sequences into the `discuss-mcp` trace-optimization loop.** The payoff for §1's third row.

The local-stdio *consent* question is closed by the §4 decision: nothing is sent to HQ, so there is nothing to
consent to. What remains is only the engineering in step 4.

## 7. Open questions
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
