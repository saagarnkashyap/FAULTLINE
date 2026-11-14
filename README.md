# FAULTLINE

Interactive Cloud Failure & Recovery Simulator. Phase 5B refines the dark operations
UI, graph visibility, and incident/recovery presentation. INCIDENT ZERO, AUTOPILOT, Adaptive retries,
seeded jitter, and circuit protection remain available. The scenario is fictional and
does not reconstruct any real vendor's infrastructure.

Use Node.js 24 LTS and npm. Run these commands from the repository root:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the localhost URL printed by Vite (normally `http://127.0.0.1:5173`).
`npm.cmd` works on Windows even when PowerShell blocks `npm.ps1`; on other systems,
use `npm` in its place. Installation requires internet access; the application
uses bundled assets and data and needs no external services at runtime.

Verification and local production preview:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

The preview URL is normally `http://127.0.0.1:4173`. The build writes `dist/`.
Use `npm.cmd run test:watch` for interactive engine tests.

Read [the architecture](docs/ARCHITECTURE.md) for the simulation contracts.
`initializeSimulation`, `step`, `failService`, `repairService`, and `resetSimulation`
are exported from `src/simulation/engine.ts`; `validateScenario` throws readable
errors for invalid typed scenarios. Invalid commands throw before changing state.
Fail and repair each advance one tick. At `maxTicks`, valid steps return the
unchanged state; command validation still applies. Scenario/config must stay fixed
for a run. Inputs are readonly and never mutated; returned snapshots can share
unchanged readonly values.

The default 12-service FAILCHAIN scenario extends the original ten-service enterprise.
Ordinary dependency arrows run from consumer to provider:

| Consumer | Required providers | Optional providers |
| --- | --- | --- |
| Identity | — | — |
| API Gateway | Identity | — |
| Email | Identity | — |
| Calendar | API Gateway | Email |
| Document Storage | Identity | — |
| AI Assistant | API Gateway, Document Storage | — |
| CRM | API Gateway | — |
| Support | CRM | Email |
| Billing | — | Notification Service |
| Notification Service | — | — |
| Gateway Instance A | Identity | — |
| Gateway Instance B | Identity | — |

The logical API Gateway is backed by a pool containing Gateway Instance A and B,
each with capacity 90 requests/tick. Those two membership links mean either backend
can serve; they are not two required dependencies. Existing gateway consumers still
depend on the logical service. The original `enterpriseScenario` is retained for
Phase 2A regression tests; the application uses its `failchainScenario` extension.

Billing and Notification Service form a branch independent of Identity. There is
no live AI integration.

## Using the simulator

- Select a service from the inventory or click a 3D node. Drag the network to
  rotate, scroll to zoom, or use Fit network to reframe it. Selection enlarges the
  node and highlights its connections without replacing its status color.
- Fail service injects a local fault and advances one tick. Step simulation
  advances exactly one more tick; dependency effects travel one hop per tick.
- Repair service starts the configured two-tick restart for a locally failed
  service. A dependency-only failure clears when its providers recover.
- Reset clears the experiment and log while retaining the selected service.
- Choose Normal, High, or Spike in the workload selector before stepping. Changing
  the preset explicitly resets the tick, failures, counters, and log. Reset retains
  the current preset. Capacity and demand use requests per tick.

The pool receives 120 requests/tick on Normal (60 per backend), 180 on High
(90 each), and 270 on Spike (135 each). Independent non-pool services retain their
Phase 2A workloads. Eligible overloaded processing services degrade
immediately and fail locally after three consecutive overloaded ticks. Manual and
overload failures are labeled separately in the inspector. Repair clears either
local failure and starts the existing two-tick restart; sustained demand can cause
another overload failure after recovery. Required-dependency outages admit no
traffic and cannot cause a false local overload. Optional/degraded providers do not
reduce nominal processing capacity in this phase.

## Reproducing FAILCHAIN

Choose Normal, select **Gateway Instance A**, then Fail service. B receives all
120 requests/tick at 133.33% utilization and processes 90, leaving 30 unserved. The
logical gateway degrades while continuing to serve through B. Two more Step actions
make B reach its third consecutive overload tick and fail locally. Throughput then
becomes zero and the logical gateway goes offline. A further Step propagates its
offline status to direct consumers; Support follows through CRM on the next tick.
Changing the threshold or repairing a backend changes this computed sequence.

Repair either failed instance to begin its existing two-tick restart. Returning
instances rejoin routing; both locally failed members require their own repairs.
Reset clears failures, counters, allocation, metrics, and events without changing
the selected workload. This manual scenario keeps retries disabled; its existing
Phase 2B routing behavior is unchanged.

Pool demand is counted once. The logical service and both backends have zero
independent external demand. Incoming pool demand always equals processed plus
unserved requests. An instance that trips during a tick processes zero requests;
its assignments are unserved, with redistribution reconsidered next tick. Inspector
metrics distinguish assigned load from actual processing. The logical gateway's
inspector also shows pool totals and run-wide metrics. Pool events appear in the
existing chronological log. There are no new dashboards or visual effects.

The inspector shows configured capacity, admitted incoming demand, available
capacity, utilization, and the overload streak. Offered demand remains visible
when a service is unavailable. A pool member's offered load is its routed share;
the pool itself preserves all external demand as processed or unserved. Incoming demand, utilization, and overload counts
start at zero at tick 0. Metrics describe the last evaluated tick; a trip retains
the overload measurements that caused it.

## RESURRECTION recovery comparison

Click **Run Comparison** in the small recovery panel. It runs three isolated 40-tick
experiments with the same Normal workload (120 new requests/tick), two 90-capacity
gateway instances, and identical commands: fail A at tick 2, repair A at 6, repair
B at 7. All use two-tick restarts, a 2,400-request FIFO queue, age limit 40 ticks,
and 100% retry eligibility. Your manual simulation and graph are unchanged.

Naive admission releases all eligible pending retries whenever capacity exists.
Controlled admission reserves capacity for new requests and admits at most
30 retries/tick within remaining capacity. All use the existing overload rules.
The partial restoration at tick 8 still briefly overloads under new demand alone;
controlled admission clears it when the second backend returns.

Adaptive adds scheduled retry eligibility with deterministic backoff/jitter and
optional client circuit protection. Expand **Adaptive settings** to adjust delays,
jitter seed/window, the retry limit shared by every strategy, and the breaker toggle.
Defaults are delays 1–8 ticks, jitter 0–2 ticks, seed 1337, at most 6 retries/request,
and breaker enabled (3 qualifying failure ticks, 3 full cooldown ticks, 10 probes).
Settings changes clear old results; run again to recompute. The graph is unchanged.

The calculated results are 660 completed unique requests and two secondary failures
for Naive, versus 4,800 completions and no secondary failures for Controlled. Naive
ends with 2,400 pending and 1,740 abandoned requests; Controlled drains the backlog
and confirms stable recovery at tick 29. Adaptive also completes 4,800 with no
secondary failures, but confirms recovery later at tick 32. Peak retry traffic is
570/tick for Naive and 30/tick for both bounded policies. Adaptive has one breaker
trip, 3 fully open ticks, and 10 successful probes. Protection can increase latency
or abandonment; it is not assumed better. Expand each run's factual engine log.

Retries are attempts for existing unique requests, not new arrivals. Successful
requests leave the queue permanently. Expiry and overflow are explicit abandonment;
failed retries keep their original age. Each run preserves:
`generated unique = completed unique + abandoned unique + pending unique`.
The ordinary pool ledger measures attempts when retry support is enabled.

Stable recovery requires the gateway and both ready backends healthy, with an
empty retry backlog and a closed breaker when configured, for three consecutive
ticks and still stable at the horizon.
Results say **Not recovered** when that has not occurred. The comparison reports
gateway-pool requests, not all independent enterprise workload. See the architecture
for per-backend processing priority, queue policies, exact metrics, and limitations.

The first retry is scheduled with attempt index 0, using
`min(maxDelay, baseDelay * 2^attempt)`, then bounded seeded jitter clipped to the same
maximum. Retries never execute before their eligible tick. Failed retries preserve
arrival age; retry-limit exhaustion is explicit abandonment. An OPEN breaker defers
client admission without changing server local health or repairing failed instances.
Deferred decisions can repeat for the same pending request and are counted
separately from backend attempts. The retained Phase 3A inputs preserve original
Naive/Controlled behavior when new settings are absent.

The inspector lists real required/optional providers and direct dependents. The
incident log displays the engine's complete event sequence, oldest first, and
follows new entries unless you scroll back. Counts reflect current engine state.
Arrows mean consumer -> provider; failure propagation travels against the arrows.
All four statuses have text labels as well as colors. Separately labeled membership
links show the gateway's backend pool without changing ordinary dependency rules.

Renderer-owned nodes and links are created once per scenario. Status/selection
updates change appearance accessors without replacing graph data, reheating the
layout, or moving the camera. Camera movement never advances simulation time.
The graph module loads separately; initialization errors and WebGL context loss
show a fallback while the service list, inspector, controls, and log remain usable.
WebGL support is required only for the 3D view. Smaller screens stack panels.

Tests use Vitest's existing Node environment for the engine, application actions,
graph direction/status projection, and static component markup. No browser testing
framework or UI library is installed. Additional pools,
realistic load balancing, generative AI agents, and Phase 6
remain out of scope. See the architecture for overload admission rules,
event chronology, recovery semantics, and the complete capacity/preset table.

## AUTOPILOT recovery controller

Enable **AUTOPILOT** in its compact panel, then use **Step simulation**. Each click
selects at most one locally failed gateway instance for an ordinary engine Repair,
or waits. It does not repair dependency-only outages or already restarting services.
The default cooldown requires two complete ticks after failure, with stable service
IDs breaking ties. Repair still takes two ticks and does not guarantee availability.
Finite limits (two repairs/instance, four total) stop repeated overload/restart loops.
The panel shows current state, last action/reason, cooldowns, and separate decisions.

Manual Fail/Repair takes priority for its entire tick and retains existing manual
permissions. Gateway repairs count against later controller budgets even while
disabled. Toggling retains history; Reset/workload changes clear history and disable
AUTOPILOT. The controller has no timers; INCIDENT ZERO can request its normal Step
integration during visible playback. Graph topology and camera are preserved.

**Compare repair policies** runs a separate, fixed 40-tick experiment. Both policies
share topology, workload, failure injection, Adaptive retry/breaker settings, queue
limits, repair permissions, cooldown, and intervention budgets. The runbook has
repair slots A at 6/B at 7; AUTOPILOT observes only current state. Blocked runbook
slots wait without rescheduling. Manual controller settings do not change this
comparison. Both complete 4,800 unique requests, abandon none, empty the backlog,
and confirm stable recovery at tick 32 using two repairs. AUTOPILOT has 21 offline
service-ticks versus 27 for the runbook. Neither has a repeated local failure.

This is a deterministic rule-based controller, not generative AI. It cannot fix
missing providers, excessive workload, or insufficient infrastructure capacity.
Tests include collapse despite interventions and a case where a fixed runbook
outperforms ID priority. See the architecture for exact metric definitions.

## INCIDENT ZERO playback

Click **Fail service** to apply the real fail command, show a brief graph-local
warning, and automatically observe one engine tick every 2 seconds. Pause, Resume,
or Skip to End from the INCIDENT ZERO panel. Turn off **Play automatically after
Fail** for manual-only stepping. Manual commands/controller changes pause playback
and accept your action; Reset and workload changes cancel it. Existing AUTOPILOT
runs only if already enabled. The isolated comparisons remain independent.

Playback stops after two safe quiet ticks, 18 additional ticks, or the engine tick
limit. Quiet never means repaired. Pending restarts, overload, retries, breaker
cooldowns, and possible AUTOPILOT repairs prevent premature quiet stopping. At the
cap the summary says **Playback paused — incident may be ongoing**; continue manually.
Timers are cleaned up and guarded against stale or duplicate callbacks.

Warnings come from confirmed commands/status events. **Critical cascade** means
at least six currently degraded/offline services. The summary separates actual
impact from potential dependency exposure; redundant or optional dependency paths
do not prove failure. Gateway capacity and unserved attempt counts come from existing
engine metrics. No user counts, financial losses, or real outage telemetry are used.

There are at most three cards and 40 retained timeline notices. Reduced-motion CSS
removes movement, the overlay only intercepts input on its notice-dismiss button, and list/summary
operation remains available without WebGL. See the architecture's manual visual
checklist; interactive browser verification was unavailable in this environment.

## Phase 5B visual polish

A shared navy/graphite palette supplies CSS variables, readable semantic status
colors, and blue interaction accents. Explorer, inspector, and experiment panels
use aligned surfaces and consistent spacing. Secondary panels stack on narrower
screens; tables scroll locally. Header Step/Reset and inspector Fail/Repair stay
easy to reach.

The graph has larger nodes, stronger directional links, descriptive hover labels,
and tighter initial framing. Fit Network keeps the current orientation; Reset
Camera restores a front view. Neither changes service positions or simulation time.
Selected nodes retain their actual status color.

Dismiss notices hides current cards without removing timeline/engine history; new
events still appear. Recovery green requires an actual healthy transition. The
controller distinguishes Monitoring, Waiting, and Repair selected without changing
its rules. Recovery tables mark differing values without declaring a winner.

Simulation, comparison calculations, and playback behavior are unchanged. Browser
access is unavailable here, so visual checks at 1440, 1280, and 768 px remain manual.
See the architecture for the full visual verification checklist.

## Command-center interface

The normal dashboard is now focused on the named 3D network, selected service,
Fail/Repair/Step/Reset, live warnings, incident timeline, and recovery lab. AUTOPILOT
is preserved internally but has no visible main panel. Short labels replace the
technical dashboard wording; detailed comparison settings remain expandable.

A confirmed failure opens a graph-local warning panel. **Confirmed now** shows real
status. **At risk next** and **Possible cascade** come from a six-step dry run of
the existing engine on cloned state. Approximate seconds use the 2-second playback
interval; paused warnings use steps instead. Predictions assume no new user action
and never change the live simulation. Unknown timing is labeled as unknown.
Minimize warnings to inspect the network freely; normal controls stay available.

Service names remain on the graph, with actual status colors and a fixed layered
3D layout. Fit/Reset Camera do not advance time or move service positions. Extreme
camera angles may crowd labels. The local browser automation host is unavailable,
so interactive graph/layout checks remain manual.

## Current appearance and warning pacing

The main screen follows the supplied command-console reference: a compact header,
service list, dominant network, inspector, and short horizontal timeline. Cyan
accents sit on navy/graphite surfaces; red, amber, green, and purple report actual
service states. Fonts stay unchanged. Playback controls and impact metrics are
under **Incident controls & impact**. Local service icons, clearer direction arrows,
and restrained glows improve recognition. Inspected connections carry a slow visual
direction marker, not measured traffic. All motion respects reduced-motion settings.
Warning rails stay outside the graph, and new notices remain two seconds apart.

Forecasts still say, for example, "May go down in ~4 seconds ? please repair API
Gateway," using actual dry-run timing and currently failed repair targets. Paused
forecasts use steps. Manual Step/Skip remain immediate, and current graph status
is never delayed by the notice reveal queue.
