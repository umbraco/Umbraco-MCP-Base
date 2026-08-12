# OpenTelemetry tracing for the HQ-hosted MCP Workers

Implementation plan. Scope is **the Workers we run** (`*.mcp.umbraco.ai`, provisioned by
`umbraco-cloud-hosted-mcp`). Local stdio telemetry is explicitly **out of scope** here — it has an unresolved
consent question, tracked in `docs/plans/monorepo/telemetry.md` §4(c).

Spans land in an OTLP backend of HQ's choosing. This gives us the tool-design signal described in
`telemetry.md` §1 (call sequences, retries, latency, error categories) plus real production debugging for the
OAuth/token paths, without asking any customer to consent to anything new — it's our runtime.

## 1. Approach: Cloudflare-native tracing, not a third-party library

Cloudflare shipped this in the window since the last time this would have been evaluated, and it removes most of
the work:

- **Automatic instrumentation** covers handler invocations, outbound `fetch` (i.e. every Umbraco Management API
  call), and binding calls including KV and Durable Objects — no code, no library.
- **Custom spans are supported** as of the [June 2026 changelog](https://developers.cloudflare.com/changelog/post/2026-06-16-custom-spans/),
  via `import { tracing } from "cloudflare:workers"` (or `ctx.tracing`): `tracing.enterSpan(name, cb)` auto-ends
  when the callback settles, and `tracing.startActiveSpan()` + `span.end()` ([July 2026](https://developers.cloudflare.com/changelog/post/2026-07-28-start-active-span/))
  covers operations outliving a callback. Custom spans nest inside the automatic ones.
- **OTLP export is built in** — destinations are configured once in the Workers Observability dashboard (name,
  OTLP endpoint, custom headers for the API key) and referenced by name from the Wrangler config.

The alternative — [`@microlabs/otel-cf-workers`](https://github.com/evanderkoogh/otel-cf-workers) (`instrument()`
/ `instrumentDO()`, own OTLP exporter over `waitUntil`) — is a real and maintained option, and unlike the native
path it has documented Durable Object support via `instrumentDO`. Reasons to prefer native anyway:

- No third-party code inside a Worker that holds customer OAuth tokens; no bundle-size or `nodejs_compat` risk.
- We get platform spans (KV, DO, outbound fetch) that a library can only partially reconstruct.
- No exporter, batching or flush plumbing of our own to get wrong.
- It requires no changes to `@umbraco-cms/mcp-hosted`'s public shape — consumers keep writing their own
  `worker.ts` (see hosted-mcp's CLAUDE.md), and instrumentation is additive.

Keep `otel-cf-workers` as the documented fallback if the DO spike in §7 fails.

Two constraints to design around, both from the native path:

- **No OTel metrics.** Export covers traces and logs only. Counters and histograms must be derived from spans in
  the backend. Since the decision in `telemetry.md` §4 is OTel-only — Analytics Engine is *not* being built — this
  is load-bearing rather than a footnote: the chosen backend has to do span→metrics, or we have no durable usage
  counts at all. See §12.
- **Custom span API gaps** (documented): no bulk `setAttributes()`, no `spanContext()` access, no
  `setOutcome()`. No `spanContext()` means **we cannot read the trace ID at runtime**, so the Umbraco.AI trick of
  stamping a `TraceId` onto an audit record to correlate later is not available to us. Don't design anything that
  depends on it.

## 2. Target span tree

```
POST /at/{alias}/mcp                        automatic — handler span
├─ kv get (OAUTH_KV token lookup)           automatic — binding span
├─ DO → UmbracoMcpAgent                     automatic — binding span
│  └─ mcp.server.init                       CUSTOM  (replaces console.log timing)
│     └─ tools/call {tool-name}             CUSTOM  ← the span that matters
│        ├─ fetch → {alias}.umbraco.io/…    automatic — outbound span
│        └─ mcp.auth.refresh                CUSTOM  (only on 401/retry path)
└─ oauth token verify                       automatic
```

Everything marked automatic arrives for free. We author three custom spans.

## 3. Custom spans to author

### 3a. `tools/call {tool-name}` — primary

Attribute names follow the OTel MCP / GenAI conventions where they exist, with our own enrichment namespace for
the rest, mirroring how Umbraco.AI adds `umbraco.ai.*` alongside `gen_ai.*`:

| Attribute | Example | Source |
|---|---|---|
| `mcp.method.name` | `tools/call` | constant |
| `gen_ai.tool.name` | `get-document-by-id` | `tool.name` |
| `mcp.session.id` | DO-scoped session id | handler `extra` |
| `umbraco.mcp.collection` | `document` | collection metadata |
| `umbraco.mcp.slices` | `read,list` | `tool.slices` |
| `umbraco.mcp.outcome` | `success` \| `validation_error` \| `api_error` \| `transport_error` \| `unknown_error` | `withErrorHandling` taxonomy |
| `umbraco.mcp.read_only` | `true` | `tool.annotations.readOnlyHint` |
| `umbraco.mcp.server.name` / `.version` | `umbraco-cms-developer-mcp-17` / `18.0.2` | `CreateServerOptions` |
| `umbraco.mcp.umbraco_major` | `17` | `expectedUmbracoMajor` |
| `umbraco.mcp.client.name` / `.version` | `claude-code` / `2.x` | `getServerRef().getClientVersion()` |
| `umbraco.mcp.tenant` | keyed hash of the Cloud alias | see §5 |
| `umbraco.mcp.modes` | `content,media` | resolved `filterConfig` |
| `umbraco.mcp.dry_run` | `false` | `withDryRun` |

Attribute values must be scalars — serialise lists with `JSON.stringify()` or join them.

Duration comes from the span itself; no `durationMs` attribute needed. Outcome is an attribute rather than span
status because `setOutcome()` isn't available yet.

`umbraco.mcp.client.name` is worth calling out: `@modelcontextprotocol/sdk` 1.26.0 exposes
`Server.getClientVersion()` (the `Implementation` from `initialize`), and the SDK already has `getServerRef()` for
reaching the live `Server` from inside a tool handler. "Which MCP clients are people actually using us from" is
one of the most valuable product questions available and it costs one call.

### 3b. `mcp.server.init` — alongside the existing logging, not instead of it

`createPerRequestServer` already hand-rolls something span-shaped: a `Math.random()` correlation id,
`initStartedAt` timing, and `:start` / `:done` log lines carrying `mode=full|degraded-auth-expired`,
`tools=<n>`, `site=<id>`, `elapsedMs`. That exists specifically to make cold-start-vs-hibernation-wake visible
(Umbraco-MCP-Base#132). Add a span carrying the same values as attributes.

**Keep the log lines, and keep the correlation id.** An earlier draft of this plan said to delete them, which
contradicts §7: Cloudflare's span API exposes no `spanContext()`, so **we cannot read the trace id at runtime**
and therefore cannot put it in a log line. Removing the hand-rolled id would leave `wrangler tail` output with
no way to tie `:start` to `:done`, with nothing to replace it — strictly worse for the person debugging a live
Worker at 2am.

The two aren't redundant, they serve different readers: spans for backend analysis after the fact, plain log
lines for someone tailing a Worker during an incident. Cloudflare correlates exported OTLP logs with traces at
the backend anyway, so carrying both costs nothing.

Note these are `console.log` in a Worker, which is fine — output goes to Workers Logs / `wrangler tail`. Don't
generalise this to the stdio entry points: there, stdout is the JSON-RPC channel, so all diagnostics must stay
on `console.error` (which is why `template/src/index.ts` uses it for its startup progress lines). Nothing in
this plan touches those.

### 3c. `mcp.auth.refresh` — the 401/retry path

`LOG_AUTH` currently gates `[mcp-auth]` diagnostic logs across token store / refresh-request / refresh-result /
401 / retry (`packages/hosted-mcp/src/types/env.ts`). These are the highest-value production spans after tool
calls — they're the paths that break. Span attributes: refresh outcome, whether a retry followed, HTTP status.
Keep `LOG_AUTH` for verbose local `wrangler tail` work; the span carries the always-on version.

## 4. Where the code goes

**The SDK cannot import `cloudflare:workers`.** `@umbraco-cms/mcp-server-sdk` is consumed by Node stdio servers;
a bare specifier only Workers resolves would break every local install. So instrumentation is injected, not
imported:

1. **`packages/mcp-server-sdk`** — define a span-shaped adapter and a `withTelemetry` decorator.

   ```ts
   // Span-oriented, not event-oriented: we need to wrap the handler, not report after it.
   export interface TelemetryAdapter {
     span<T>(name: string, attrs: Record<string, string | number | boolean>, fn: () => Promise<T>): Promise<T>;
   }
   ```

   Default adapter is pass-through (`fn()`), so an unconfigured server pays one function call and nothing else —
   the Umbraco.AI "zero overhead when not configured" property. Register it the same way `server-ref.ts` handles
   the server instance (module-scoped setter, with its existing justification: "DOs are single-threaded so a
   module-scoped ref is safe per instance"). Add `withTelemetry` to `withStandardDecorators` so every tool in
   every product is covered by one edit.

   Ordering inside the chain matters: it must sit **inside** `withErrorHandling` so the span records the outcome
   the error handler classified, and **outside** `withDryRun` so dry-run calls are still visible as such.

2. **`packages/hosted-mcp`** — `createCloudflareTracingAdapter()` wrapping `tracing.enterSpan`, registered from
   `createPerRequestServer`. This is the only file that imports `cloudflare:workers`.

3. **Product repos** (`Umbraco-CMS-MCP-Dev`, `Umbraco-CMS-MCP-Editor`) — bump the `@umbraco-cms/mcp-hosted`
   dependency. No source change if the adapter is registered inside `createPerRequestServer`; that's the design
   goal, since those repos each own their own `worker.ts`.

4. **`umbraco-cloud-hosted-mcp`** — Wrangler template + destination wiring (§6).

## 5. Privacy: what must never reach a span

Per `telemetry.md` §5, and it needs restating because spans are easy to over-fill:

- **No tool arguments or results.** Argument values are customer content.
- **No raw error messages.** `withErrorHandling` forwards `error.message` and ProblemDetails `detail` verbatim
  into tool results; those routinely carry paths, IDs and API payloads. Spans get the **category** only.
- **No plaintext Cloud alias.** It's a customer identifier and it's in the URL. Use a keyed hash for
  `umbraco.mcp.tenant`; keep the mapping internal. Note the automatic handler span will contain the request URL —
  **including the alias** — so this is a redaction question for the *automatic* spans too, not just ours. Check
  what the handler span records before enabling export, and factor it into the backend choice.
- **No user identity.** `props` carries the authenticated backoffice user; no user id, name or email on spans.
- **No tokens**, obviously — including in `mcp.auth.*` attributes.

## 6. Infrastructure changes (`umbraco-cloud-hosted-mcp`)

The generated Wrangler config already carries observability:

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

…in `terraform/modules/umbraco-mcp/templates/wrangler.generated.toml.tftpl:38`, with a comment explaining why it
lives in the template rather than in Terraform (per-deployment setting; setting it on the TF worker shell doesn't
persist and causes a perpetual plan diff). Traces go in the same place:

```toml
[observability.traces]
enabled = true
destinations = [ "<destination-name>" ]
head_sampling_rate = 1      # start at 1 in dev; tune per §8
persist = false             # export only; skip dashboard storage + its separate billing
```

Two things that are *not* Terraform-shaped and need calling out:

- **Destinations are created in the Cloudflare dashboard** (name, OTLP endpoint, custom headers). No API or
  Terraform resource is documented. So the destination is click-ops while the Wrangler config that references it
  is generated — a split worth documenting in the repo's README, and the destination name must be a module
  variable (per-env: dev and prod should not share a destination).
- **The OTLP auth header lives in Cloudflare's destination config**, not in `kv-dev-global-ai-mcp`. That deviates
  from the repo's "secrets in Key Vault" pattern. Flag it rather than quietly breaking the convention.

Two known landmines in that repo:

- **`versions.tf` pins `cloudflare ~> 5.19.0`** precisely because "from 5.20+ the provider sends
  `observability.traces.propagation_policy = "authenticated"` by default, which the account rejects (API 100342:
  *requires the trace propagation feature to be enabled*)". That is a trace-propagation feature gate on the
  Umbraco Cloudflare account, and it is very likely the same capability cross-DO span nesting depends on.
  **Getting that feature enabled on the account is a prerequisite, not a detail** — and it may also unblock
  raising the provider pin. Note this sits at the Terraform/API layer, *not* the Wrangler layer: the spike (§7)
  confirmed `propagation_policy` isn't a Wrangler config key at all, so the template change below is unaffected by
  the pin.
- ~~**`compatibility_date` defaults to `2025-04-01`**, so a bump is probably required.~~ **Resolved by the spike
  (§7): not required.** The tracing API is gated on runtime version, not compat date, and behaves identically on
  `2025-04-01`. Leave the compat date alone.

## 7. Spike results

Run locally against wrangler 4.114.0 / miniflare 4.20260722.0 / `@cloudflare/workers-types` 5.20260727.1, using a
throwaway Worker + Durable Object that mirrors this topology (outer fetch handler → span → DO binding call → spans
inside the DO). Driven through `unstable_dev`.

**The DO question — the one that gated the plan — is answered: it works.** Inside the Durable Object, all of the
following succeeded with no exception:

| Probe | Result |
|---|---|
| `import { tracing } from "cloudflare:workers"` visible inside the DO | yes |
| `ctx.tracing` on the Worker's `ExecutionContext` | yes |
| `tracing.enterSpan()` + `span.setAttribute()` inside the DO | yes |
| Nested spans inside the DO (`server.init` → `tools/call`) | yes |
| Span held across an `await` boundary | yes |
| Outbound `fetch` wrapped in a custom span | yes |
| `tracing.startActiveSpan()` returning a span ended later via `span.end()` | yes |

**It also never throws outside a request context.** `enterSpan` at module top-level, in the DO constructor, and
inside `ctx.waitUntil()` after the response was returned all returned normally, yielding an inert span. So the
`TelemetryAdapter` in §4 needs **no context guards and no try/catch** — a meaningful simplification, and it means
a module-scoped adapter can't crash a tool call that happens to run on an unusual path.

**The compatibility-date risk is gone.** The API behaves identically under `compatibility_date = "2025-04-01"`
(the repo's current default) and `"2026-07-01"` — it's gated on runtime version, not on the compat date. **No
compat-date bump is required**, which removes the riskiest item from §6.

**The Wrangler config change is valid on the version already pinned.** wrangler 4.114.0's own config schema
defines `observability.traces` with exactly `enabled`, `head_sampling_rate`, `persist`, `destinations` — the keys
§6 uses. Note `propagation_policy` is *not* in the Wrangler schema; it's a Terraform-provider/API-level field on
the worker resource. So the template change is **orthogonal to the `cloudflare ~> 5.19.0` pin** — they touch
different layers, and fixing one doesn't fix or block the other.

**The full `Span` surface is exactly three members**, confirming the documented gaps rather than hiding extras:

```ts
declare abstract class Span {
  get isTraced(): boolean;
  setAttribute(key: string, value?: boolean | number | string): void;
  end(): void;
}
```

`isTraced` is a useful runtime probe (cheap "am I being sampled" check, e.g. to skip building an expensive
attribute value).

### What the spike could *not* answer

`isTraced` was **`false` in every position, locally** — top-level Worker included — and miniflare contains no
trace-collection implementation at all. So local dev creates spans that go nowhere. Two consequences:

- **Neither export nor span *nesting* can be verified locally or in CI.** The spike proves the API is callable and
  safe in our topology; it cannot prove a `tools/call` span lands in the backend correctly parented under the
  automatic DO binding span. That needs a deployed Worker with a real destination. The beta announcement lists
  trace-context propagation as still landing, and the `versions.tf` note records that this account currently
  *rejects* `propagation_policy = "authenticated"` (API 100342) — so nesting across the DO boundary remains the
  open risk, and the account feature is likely its prerequisite.
- **`isTraced` must not be used as a feature flag in tests.** It is `false` locally regardless of config, so any
  code branching on it is effectively dead in the unit/integration suites.

Still open, and answerable only on a deployed dev Worker:

1. Do custom spans reach the destination, and do they nest under the automatic handler/DO/fetch spans?
2. Is the account-level trace-propagation feature required for (1), and does enabling it also unblock raising the
   `cloudflare` provider pin past 5.19.x?
3. What does the automatic handler span record for the request URL — i.e. does it capture the Cloud project alias?
   Decides the §5 redaction question.

Reproduction: `scratchpad/otel-spike/` (throwaway; ~60 lines of Worker + a `wrangler.toml`).

## 8. Cost

Export is on Workers Paid and includes 10M events/month per type, with $0.05/million beyond that from
**1 October 2026**; dashboard storage is billed separately ($0.60/million, 7-day retention on Paid) which
`persist: false` avoids. **Free beta ends 30 September 2026** — roughly two months out, so build and evaluate
during the free window but budget before it closes.

Sizing: one tool call produces our custom span plus a handful of automatic ones. Assume ~6–10 spans per tool
call. 10M events/month therefore lands somewhere around 1–1.5M tool calls/month across all four Workers — likely
generous for now, but it is the number that will move as adoption grows. Start `head_sampling_rate = 1` in dev
for signal; consider lowering in prod once volume is known. Sampling is per-request at the head, so a lowered
rate drops whole traces, not individual spans — good for cost, and it means rare errors can be missed. If that
becomes a problem, tail sampling via Tail Workers is the documented answer.

## 9. Verification

- **Unit** (`packages/mcp-server-sdk`) — `withTelemetry` calls the adapter with the expected name and attributes;
  the default adapter is pass-through; a throwing handler still records an outcome and rethrows for
  `withErrorHandling`. Confirm the existing ~425 SDK tests still pass.
- **Unit** (`packages/hosted-mcp`) — adapter registration in `createPerRequestServer`; assert **no** forbidden
  attribute (arguments, raw messages, plaintext alias) is ever set. This is the test that keeps §5 true over time;
  write it as a deny-list so a future contributor adding an attribute has to confront it.
- **Integration** (`npm run test:integration`) — existing Wrangler `unstable_dev` suite must stay green. Do **not**
  try to assert on traces here: §7 established that local dev collects nothing and `isTraced` is always `false`.
  The most a local test can prove is that instrumented handlers still behave identically — which is worth having,
  since that's the regression that would actually hurt.
- **Deployed dev** — the real check: deploy to `cms.developer.17.dev.mcp.umbraco.ai`, drive a tool call through
  MCP Inspector, confirm the trace arrives at the destination with the expected tree from §2.
- CI must be watched on every PR per the root CLAUDE.md — the suite includes checks that don't run locally.

## 10. Sequencing

| # | Change | Repo | Depends on |
|---|---|---|---|
| 1 | Trace-propagation feature enabled on the Umbraco CF account | (account/support) | — |
| 2 | ~~Spike: does the API work in a DO~~ **done, §7 — it does** | `umbraco-mcp-base` | — |
| 3 | `TelemetryAdapter` + `withTelemetry` in `withStandardDecorators` | `umbraco-mcp-base` (SDK) | — |
| 4 | Cloudflare adapter + `tools/call` span, wired in `createPerRequestServer` | `umbraco-mcp-base` (hosted-mcp) | 3 |
| 5 | Add `mcp.server.init` + `mcp.auth.refresh` spans alongside the existing logs (§3b — the logs stay) | `umbraco-mcp-base` | 4 |
| 6 | Destination created; Wrangler template + module var; compat-date decision | `umbraco-cloud-hosted-mcp` | 1 |
| 7 | Deploy dev, verify trace tree end to end | both | 4, 6 |
| 8 | Dep bump in the two product repos, deploy prod | `Umbraco-CMS-MCP-Dev`, `-Editor` | 7 |
| 9 | Feed real `tools/call` sequences into the `discuss-mcp` trace-optimization loop | `umbraco-mcp-base` | 8 |

Steps 3–5 are behaviour-neutral until a destination exists, so they can land on `dev` behind nothing more than
the pass-through default — and since the gating spike passed, **they no longer wait on step 1**. Step 1 blocks
only step 7's nesting verification. That means the library work and the account/infra work can proceed in
parallel, which they couldn't under the original plan.

Step 9 is the actual payoff — everything before it is plumbing.

## 11. Decisions needed

- **Which OTLP backend?** Cloudflare exports to any OTLP endpoint (Honeycomb, Grafana Cloud, Axiom, Sentry are
  the documented ones). This is a data-processing decision as much as a technical one: spans will carry Cloud
  project identifiers, so **where the backend stores data and under what terms needs checking against current
  DPA terms before anything is exported** — I'm not in a position to assert a residency position here. Azure
  Monitor is worth a look given the rest of the estate, but its documented OTLP ingestion paths go via the OTel
  Collector or Azure Monitor Agent rather than a bare endpoint you can paste into Cloudflare, so it likely needs
  a collector hop — verify before assuming it's the easy option.
- **Per-tenant visibility, or strictly aggregate?** Decides whether `umbraco.mcp.tenant` exists at all. Note the
  automatic handler span may force the issue via the URL regardless (spike 3).
- **Editor vs developer MCP.** Editor sessions are non-technical end users; developer sessions are staff. Same
  instrumentation, but possibly different sampling or a different destination.
- **Sampling rate for prod**, and whether Tail Workers for guaranteed error capture is in scope now or later.

## 12. Reporting — and why traces alone won't answer "which tools are used"

Every `tools/call` span carries `gen_ai.tool.name`, so "which tools are used" is a group-by away. The catch is
that **a tracing backend is a debugging store, not a usage-reporting store**, and two things get in the way of
durable per-tool counts:

- **Head sampling scales your numbers.** `head_sampling_rate` drops whole traces *at the Worker, before export*.
  At `0.05` a tool called 1,000 times shows up ~50 times. Counts become estimates that must be scaled by a rate
  someone can change in a Wrangler config — a footgun for any number that ends up in a product review. Either keep
  the rate at `1` for the MCP Workers, or record the rate somewhere the report can divide by it.
- **Retention is short.** Cloudflare's own dashboard is 3 days (Free) / 7 days (Paid) — fine for "why did this
  break", useless for "was this tool used last quarter". Third-party backend retention varies and is the thing
  actually being bought.

The standard fix is to derive metrics from spans at ingest, so counts persist long after the spans expire:

- **[Span metrics connector](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md)**
  in an OTel Collector — produces R.E.D. (rate/error/duration) metrics per unique dimension set.
- **[Grafana Cloud Tempo metrics-generator](https://grafana.com/docs/grafana-cloud/send-data/traces/configure/metrics-generator/)**
  — same idea with no collector to run: it writes `traces_spanmetrics_calls_total` and latency histograms straight
  into the stack's hosted Prometheus. Currently the cleanest single-vendor answer if we want traces *and*
  long-retention usage counts without operating infrastructure.

Cardinality needs a decision here, not later: the developer MCP exposes hundreds of tools, so a metric dimensioned
on `gen_ai.tool.name` × tenant × client name would multiply out fast. Recommendation: dimension the **metrics** on
tool name + outcome only, and keep tenant/client/session on the **spans** where high cardinality is free. The span
metrics connector has an `aggregation_cardinality_limit` circuit breaker as a backstop.

**This makes span→metrics a hard requirement on the backend, not a nice-to-have.** The decision in `telemetry.md`
§4 is OTel-only, so there is no Analytics Engine fallback for counters. Traces answer *why a call failed*;
span-derived metrics are now the *only* thing that will answer *how often it happened*. A backend that ingests
OTLP traces but can't derive and retain metrics from them will satisfy the plan on paper and fail the actual
question in §1 — treat "does it do span metrics, with what retention" as a gating criterion when choosing, not a
comparison detail.

**Reporting "which tools are never used" needs a denominator telemetry can't supply.** Absence of a span is not
evidence a tool exists. Take the full tool list from the SDK's existing CLI introspection (`--list-tools` via
`handleCliCommands`) at build time, subtract the observed set, and the difference is the dead-weight list — which
is the number actually worth acting on.

## 13. Adapter reach — self-hosted and local

The `TelemetryAdapter` seam in §4 is deliberately generic, but it does not follow that all three deployments work
"if you attach" with the same code:

| Deployment | Adapter | Works today after this plan? |
|---|---|---|
| HQ-hosted Workers | `createCloudflareTracingAdapter()` | Yes — that's this plan |
| **Customer self-hosted Workers** (consumers of `@umbraco-cms/mcp-hosted`) | **same Cloudflare adapter, no code change** | **Yes** — they add `[observability.traces] destinations = […]` pointing at a destination in *their* dashboard. Requires Workers Paid |
| **Local stdio** (`@umbraco-cms/mcp-dev`, editor, forms, scaffolded servers) | **needs a Node adapter — not written** | No. The seam accepts it; the implementation is additional work |

The self-hosted case is the strong one: because instrumentation lives in `createPerRequestServer` and the spans go
wherever that Worker's own destination points, a customer running their own hosted MCP gets full tracing into
their own stack for the cost of a config block. Nothing routes to HQ.

The Node adapter (`@opentelemetry/sdk-node` + an OTLP exporter, registered from `index.ts` next to the existing
`setServerRef()` call) is a small, separate piece of work. Two notes for whoever picks it up:

- **Flushing matters.** A stdio server is a short-lived process; spans buffered at exit are lost. The template
  already installs `SIGINT`/`SIGTERM` handlers for `mcpClientManager.disconnectAll()` — that's where a
  force-flush belongs.
- **There is no consent question left.** `telemetry.md` §4 records the decision: no phone-home in any product. A
  customer-attached OTel exporter sends data to the customer, which is precisely the Umbraco.AI contract ("when
  OpenTelemetry is not configured, there is zero overhead") and needs consent from nobody. The only thing standing
  between local stdio and full observability is this adapter — no legal review, no RFC.
- **HQ gets nothing from local installs, by design.** Follows directly from the same decision; `telemetry.md` §4
  states the trade-off. Worth remembering before anyone reads a per-tool usage chart as covering all deployments —
  it covers the hosted Workers only.

## Sources

- Cloudflare: [Workers automatic tracing open beta](https://blog.cloudflare.com/workers-tracing-now-in-open-beta/),
  [Traces](https://developers.cloudflare.com/workers/observability/traces/),
  [Custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/),
  [custom spans changelog](https://developers.cloudflare.com/changelog/post/2026-06-16-custom-spans/),
  [`startActiveSpan` changelog](https://developers.cloudflare.com/changelog/post/2026-07-28-start-active-span/),
  [Exporting OpenTelemetry data](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/),
  [Observability overview](https://developers.cloudflare.com/workers/observability/),
  [Agents tracing](https://developers.cloudflare.com/agents/runtime/operations/observability/tracing/)
- Alternative: [`otel-cf-workers`](https://github.com/evanderkoogh/otel-cf-workers)
- Conventions: [OTel MCP attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/mcp/)
  (deprecated in the main registry; moved to [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)),
  `18/ai-in-umbraco/concepts/observability.md` (Umbraco.AI's `gen_ai.*` + `umbraco.ai.*` precedent)
- Azure: [OpenTelemetry ingestion options for Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-summary)
- This repo: `packages/hosted-mcp/src/server/create-server.ts`, `packages/hosted-mcp/src/types/env.ts`,
  `packages/mcp-server-sdk/src/helpers/{tool-decorators.ts,server-ref.ts}`, `template/src/worker.ts`
- Infra: `umbraco-cloud-hosted-mcp/terraform/{versions.tf,variables.tf,modules/umbraco-mcp/templates/wrangler.generated.toml.tftpl}`
- Related: `docs/plans/monorepo/telemetry.md`
