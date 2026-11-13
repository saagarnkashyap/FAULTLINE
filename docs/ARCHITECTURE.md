# FAULTLINE — Architecture

Status: Phase 5B foundation plus the simplified command-center UI and bounded
incident forecasting, with
AUTOPILOT, backoff, seeded jitter, circuit breaker, and Adaptive recovery experiments.
Phase 1 dependency/recovery semantics and Phase 2A overload rules remain the
baseline. Phase 6 is not implemented.

## Decision and boundaries

The proposed stack is practical: React + TypeScript + Vite, `react-force-graph-3d`,
plain CSS, Vitest, and bundled scenario data. Start with one small graph and a
discrete, rule-based simulation. The Butterfly Effect, FAILCHAIN, and RESURRECTION
are capabilities of one application, not separate packages or engines.

All simulation runs in the browser. Use localhost for development and serving the
static build; this is a file-serving tool, not an application backend. Dependency
installation initially needs internet access; running an installed build must not.
Bundle all assets locally: no paid APIs, CDN assets, remote fonts, telemetry,
accounts, Microsoft integrations, database, Docker, or authentication.

FAULTLINE models a fictional enterprise. Outage inspiration is context only;
neither scenarios nor rules claim to reconstruct Microsoft infrastructure or
establish the cause of any real incident.

## Proposed structure

The application keeps the following small boundaries:

```text
docs/ARCHITECTURE.md
src/
  main.tsx
  App.tsx                        # owns simulation and UI selection state
  appState.ts                    # UI actions delegate to the engine; preset changes reset
  incident/
    incidentState.ts             # UI playback lifecycle, engine-event alerts, impact/exposure
    prediction.ts                # cloned, bounded replay of the existing application Step path
  hooks/
    useIncidentPlayback.ts       # one cancellable presentation timeout per engine tick
  styles.css
  theme.ts                       # shared CSS/WebGL palette; no simulation rules
  simulation/
    types.ts                     # domain types; no React/Three.js imports
    engine.ts                    # initialize, validate, step, reset
    engine.test.ts               # Vitest tests without a browser
    routing.ts                   # one two-member pool: allocation, accounting, metrics
    retries.ts                   # optional bounded FIFO retry cohorts and admission
    retryScheduling.ts           # capped exponential delay and stable cohort hash jitter
    circuitBreaker.ts            # one client-side gateway breaker, separate from service health
    experiments.ts               # Naive/Controlled/Adaptive retry-policy comparison
    autopilot.ts                 # pure decisions, observed history, ordinary engine commands
    autopilotExperiments.ts      # Fixed Runbook vs AUTOPILOT repair-policy comparison
  scenarios/
    enterprise.ts                # one typed, bundled scenario
    failchain.ts                 # default enterprise extension with gateway backends
    resurrection.ts              # fixed recovery experiment inputs and command schedule
    autopilot.ts                 # shared resilience settings and fixed runbook slots
    workloads.ts                 # fixed Normal, High, and Spike demand maps
  graph/
    toGraphData.ts               # domain IDs -> separate renderer objects
    ServiceGraph.tsx             # visualization and selection callbacks
    displayLayout.ts             # fixed renderer-only layered layout and label placement
    GraphLabels.tsx               # persistent DOM names projected from actual 3D coordinates
  components/
    Controls.tsx
    ServiceDetails.tsx
    EventLog.tsx
    RecoveryComparison.tsx        # isolated results table; does not own manual state
    AutopilotPanel.tsx            # explicit controller toggle/status and separate comparison
    IncidentPlayback.tsx         # playback controls and nonblocking summary
    IncidentOverlay.tsx          # brief graph-local fault banner and recent cards
    IncidentAlerts.tsx            # at most three visual cards
    IncidentSummary.tsx           # actual impact, exposure, dependencies, bounded timeline
    ServiceCard.tsx               # compact inspector used by the main interface
    IncidentCommandOverlay.tsx    # confirmed status plus bounded forecast warnings
    LiveIncident.tsx              # concise playback controls and actual impact
    ProductTimeline.tsx           # readable, genuine status/recovery changes
```

Vite configuration and the package lockfile live at the root. State stays in `App`
using React's built-in state tools. No router, global
store, plugin system, generic rules framework, or monorepo is needed.

Dependencies flow from UI to the simulation API; the engine knows nothing about
React, browser timers, graph coordinates, or Three.js. Graph callbacks send service
IDs back to the UI. The adapter creates owned copies for the renderer; never pass
domain objects for layout code to modify. Retain graph object identity by ID
between status updates so the layout does not restart on every tick.

## Core data contracts

Core TypeScript contracts (the source of truth is `src/simulation/types.ts`):

```ts
type ServiceId = string;
type ServiceStatus = "healthy" | "degraded" | "offline" | "recovering";

interface ServiceNode {
  readonly id: ServiceId;
  readonly name: string;
  readonly description: string;
  readonly capacityPerTick?: number;
}

interface Dependency {
  readonly consumerId: ServiceId;
  readonly providerId: ServiceId;
  readonly kind: "required" | "optional";
}

type LocalCondition =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly cause?: { readonly type: "overload"; readonly tick: number } }
  | { readonly kind: "recovering"; readonly readyAtTick: number };

interface ServiceRuntime {
  readonly local: LocalCondition;
  readonly status: ServiceStatus;
  readonly traffic?: ServiceTraffic;
}

interface ServiceTraffic {
  readonly offeredDemandPerTick: number;
  readonly incomingDemandPerTick: number;
  readonly availableCapacityPerTick: number;
  readonly utilizationPercent: number;
  readonly consecutiveOverloadedTicks: number;
}

type WorkloadPresetId = "normal" | "high" | "spike";
interface WorkloadPreset {
  readonly id: WorkloadPresetId;
  readonly name: string;
  readonly description: string;
  readonly demandPerTick: Readonly<Record<ServiceId, number>>;
}

interface SimulationConfig {
  readonly tickDurationMs: number; // simulated time per tick, not a wall clock
  readonly recoveryTicks: number;  // fixed local restart duration
  readonly maxTicks: number;       // bounds an in-memory experiment
  readonly overloadFailureTicks?: number; // defaults to 3
}

type SimulationCommand = {
  readonly type: "fail" | "repair";
  readonly serviceId: ServiceId;
};

type SimulationEvent = { readonly tick: number; readonly serviceId: ServiceId } & (
  | { readonly type: "command-applied"; readonly command: "fail" | "repair" }
  | {
      readonly type: "status-changed";
      readonly from: ServiceStatus;
      readonly to: ServiceStatus;
      readonly providerIds: readonly ServiceId[]; // direct blocking/degrading causes
    }
  | {
      readonly type: "overload-started" | "overload-failed";
      readonly demandPerTick: number;
      readonly capacityPerTick: number;
      readonly utilizationPercent: number;
      readonly consecutiveOverloadedTicks: number;
      readonly afterRepair?: boolean; // retry-enabled pool member history
    }
);

interface SimulationState {
  readonly tick: number;
  readonly services: Readonly<Record<ServiceId, ServiceRuntime>>;
  readonly events: readonly SimulationEvent[];
  readonly routingPool?: RoutingPoolState;
  readonly metrics?: SimulationMetrics;
  readonly retry?: RetryState;
  readonly circuitBreaker?: CircuitBreakerState;
}

interface RoutingPool {
  readonly id: string;
  readonly serviceId: ServiceId; // logical gateway
  readonly memberIds: readonly [ServiceId, ServiceId];
  readonly demandPerTick: number;
}
```

A `SimulationScenario` holds its ID, node list, dependency list, config, optional
`workload`, optional singular `routingPool`, and optional `retry` configuration. Configuration stays outside runtime
state and fixed during a run.
Initial state is tick 0, all services locally ready/healthy, and an empty log.
Traffic-enabled services start with configured offered demand and nominal available
capacity, but zero incoming demand, utilization, and overload count: no tick has
been evaluated. Reset creates this state again. Selection and camera are UI state.
Scenarios without a workload retain Phase 1 behavior and omit runtime traffic data.
Pool-enabled scenarios also initialize a pool ledger and run metrics with zero
evaluated demand/processing/unserved requests at tick 0, ready member destinations,
and nominal available capacity. There are no synthetic tick-0 routing events.

Validate unique nonempty service IDs, existing dependency endpoints, no duplicate
consumer/provider pairs, no self-links, and no cycles for Phase 1. Config values
must be positive integers; start with 1,000 ms, 2 recovery ticks, and 1,000 max ticks.
Reject invalid scenarios before starting, with a readable error. Capacity, when
provided, must be a positive safe integer. A workload requires capacity and an
explicit nonnegative safe-integer demand for every service; unknown demand IDs are
rejected. The optional overload threshold must be a positive safe integer.

## Dependency and status rules

An arrow **consumer -> provider** means “depends on.” Draw arrows in that direction;
failures travel in the reverse direction. Thus `C -> B -> A` means an A failure
can affect B and then C. The graph must show this convention in its legend.

Keep local condition separate from effective status. A service disabled by a
dependency is not locally broken and does not need its own repair.

Evaluate effective status in this precedence order:

1. Locally failed (manual or latched overload): **offline**, until repaired.
2. Locally restarting: **recovering**, unavailable to consumers.
3. Any required provider offline/recovering: **offline**.
4. A logical service with no usable pool capacity: **offline**. Insufficient pool
   throughput makes it degraded without creating a local overload failure.
5. An eligible processing service reaching its overload threshold: latch a local overload
   failure and become **offline**.
6. Any required provider degraded, optional provider nonhealthy, or eligible local
   overload below its threshold: **degraded**.
7. Otherwise: **healthy**.

Multiple dependency effects use the worst applicable result; never sum arbitrary
health scores. `degraded` marks reduced health; Phase 2A does not reduce configured
capacity merely because a provider is degraded. `recovering` describes a local restart, not proof that dependencies
are ready. After restarting, a node may still be offline because of its providers.

## Simulation update cycle

The intended boundary is a pure `step(scenario, previousState, optionalCommand)`
returning a new state. Phase 1 accepts at most one command per step. Fail/Repair
buttons perform one step with that command; Step advances without a command.

1. Validate the command before advancing. Unknown IDs are errors. Fail is valid
   unless already locally failed; Repair is valid only when locally failed.
   Invalid commands leave state unchanged and show a UI message.
2. Set the next tick to `previous.tick + 1`. Complete existing local restarts whose
   `readyAtTick` has arrived, then apply the command. Fail sets local condition to
   failed; Repair sets it to recovering with `readyAtTick = nextTick + recoveryTicks`.
3. Prepare every service's dependency availability using those local conditions
   and **only previous-tick provider statuses**. Do not use partly updated provider
   health, including new logical gateway health, anywhere in this stage.
4. If retries are enabled, expire old cohorts and select only cohorts due this tick.
   Compute physical eligible capacity. If a circuit breaker is configured, advance
   its admission phase when cooldown ends, limit admitted new requests/probes, then
   apply retry budgets. Admitted new requests plus admitted retries form this tick's
   pool attempt demand. Route it once.
   The logical gateway must be locally ready and not
   blocked by a required provider. Member eligibility uses the same prepared
   conditions. Equal shares go to eligible backends; no eligible destination means
   all pool demand is unassigned. Ordinary services retain their independent demand.
5. Evaluate processing-service demand, utilization, overload counters, and trips
   using the Phase 2A mechanism. Members receive only assigned pool traffic. The
   logical gateway is an aggregate, never another independent overload processor.
6. Account for processing after overload evaluation. Newly failed backends process
   zero requests. Aggregate surviving capacity, throughput, and unserved requests;
   combine pool health with the logical gateway's prepared local/dependency health.
   Do not reroute again within this tick. Other services still see the gateway's
   previous snapshot until their next tick.
7. Update breaker outcomes from failed/successful **admitted** attempts only. If
   enabled, classify actual processing as new versus retried requests, remove
   successful requests, requeue failed eligible requests without renewing their
   age, enforce queue/retry limits, schedule future retries, and assess stable
   recovery (including a closed breaker when configured). Commit these ledgers,
   services, the pool ledger, and metrics together. Baseline events are ordered:
   command first, any routing-destination change second, then services by sorted
   ID (overload event before status change), then any pool-health transition.
   Retry release events follow routing, completed local restarts precede their
   service's overload/status events, and queue/abandonment/stability events follow
   pool-health events. All additional events are gated by optional retry support.
   Direct provider cause IDs are sorted. Pool events separately explain backend
   membership/throughput effects. No UUIDs or wall-clock timestamps are used.

No recursive settling occurs: ordinary dependency edges always cost one tick.
Pool aggregation is part of the logical gateway's own health calculation, not an
extra ordinary dependency hop. UI reads the resulting snapshot. At `maxTicks`,
stepping preserves the exact state; Reset remains available.

For `C -> B -> A`, failing A from tick 0 makes A offline at tick 1, B at tick 2,
and C at tick 3. A repair at tick 4 with duration 2 leaves A recovering at ticks
4–5; it becomes healthy at 6, B at 7, and C at 8 if there are no other blockers.
Dependency-only failures clear automatically as healthy provider states propagate.

Identical scenario/config and tick-indexed commands must produce identical states
and event order. Do not read `Date.now()`, random values, frame rates, or layout
positions in the engine. Phase 5A automatic playback requests discrete UI steps;
slow frames must never change a step's result. Visual layout need not be identical
between runs. Treat prior states and scenario inputs as immutable.

## Traffic and capacity — Phase 2A

Use **requests per tick**, independent of wall-clock speed. Capacity and offered
external demand are fixed scenario inputs. Outside the explicit Phase 2B pool,
demand is neither routed along dependency edges nor redistributed when a service
fails. Each ordinary service retains its own external workload entry; there is no
inferred upstream request amplification.

A service can admit/process requests when it is locally ready and has no required
provider offline/recovering in the previous snapshot. Required-provider degradation
and optional-provider loss still permit nominal capacity. Manual failure, local
restart, and required-provider unavailability admit zero demand and expose zero
available capacity/utilization. They reset the overload streak to zero and emit
no overload events. Configured offered demand remains visible for explanation.

For eligible services, incoming demand equals offered demand and available capacity
equals configured capacity. Utilization is `incoming / capacity * 100`, rounded to
two decimals for display only; overload compares integer requests directly.

- Demand <= capacity: zero consecutive overloaded ticks and no overload penalty.
- Demand > capacity: increment the consecutive count and become degraded. Emit
  `overload-started` only on the first tick of that streak.
- At count 3 (or the configured threshold): emit `overload-failed` and latch
  `{ kind: "failed", cause: { type: "overload", tick } }`. The status is offline.
  Manual failures retain `{ kind: "failed" }`; absence of an overload cause means
  manual injection. Dependency-only outages keep local condition ready.

Runtime metrics describe the evaluated tick. The trip tick retains its overload
measurements (e.g. 150 incoming, 100 capacity, 150%, count 3), explaining the trip
even though the resulting status is offline. On the next unavailable tick those
operational metrics and the counter become zero; the local failure cause/tick stays
latched. A service may legitimately admit demand on the same tick its provider
fails, because it still reads that provider's previous healthy snapshot.

Repair accepts either local failure cause, clears that cause, and starts the same
two-tick restart as Phase 1. No traffic is admitted during restart. When it ends,
dependency checks apply first, then load evaluation resumes with a fresh counter.
An unchanged excessive workload can trip the service again after three eligible
ticks. A blocked consumer never needs its own repair. Reset clears all failures,
traffic measurements/counters, and logs while retaining the selected preset.

Presets are fixed, reproducible demand maps in `scenarios/workloads.ts`. The
selector explicitly says it resets the experiment: choosing a preset initializes
tick 0 and clears failures/logs before the next step. Reset preserves that choice.
UI actions and rendering use the same active scenario; the graph receives stable
base topology, so selecting a workload does not rebuild physics objects or camera.

The retained ten-service **Phase 2A regression scenario** uses these values:

| Service | Capacity | Normal | High | Spike |
| --- | ---: | ---: | ---: | ---: |
| Identity | 200 | 100 | 180 | 160 |
| API Gateway | 240 | 160 | 250 | 360 |
| Email | 120 | 70 | 110 | 180 |
| Calendar | 100 | 50 | 90 | 90 |
| AI Assistant | 80 | 40 | 76 | 120 |
| Document Storage | 200 | 120 | 180 | 160 |
| CRM | 100 | 60 | 90 | 90 |
| Support | 80 | 35 | 72 | 65 |
| Billing | 100 | 40 | 40 | 40 |
| Notification Service | 120 | 60 | 60 | 60 |

All table values are requests/tick. Normal stays within capacity; High overloads
Gateway while several other services approach their limits; Spike overloads
Gateway, Email, and AI Assistant at 150%. Billing's branch remains independent.

These are illustrative simulator policies. Ordinary service demand remains
independent. Pool routing and accounting below extend this baseline without
changing the Phase 2A regression scenario or its original tests.

## FAILCHAIN — one gateway pool (Phase 2B)

The application's default `failchainScenario` extends the enterprise to 12 nodes.
The existing logical API Gateway and all of its consumers remain. Two new backend
nodes, Gateway Instance A and B, each have capacity **90 requests/tick** and require
Identity. The gateway retains its own Identity dependency. Pool membership is an
explicit OR/capacity relationship, not two ordinary required dependencies.
`enterpriseScenario` remains available for unmodified Phase 2A regression tests.

The singular pool configuration has an ID, logical service ID, exactly two distinct
member IDs, and external demand. It uses equal routing, without weights. Sort
eligible IDs, assign `floor(demand / eligibleCount)` to each, then give any integer
remainder to the first sorted ID. Healthy or degraded operational members can
receive requests; locally failed/recovering or required-dependency-blocked members
cannot. Routing uses updated local conditions and previous provider snapshots.

The logical gateway and both members must have **zero independent workload demand**.
Their external source is the pool alone. Workload switching resets the experiment
and sets the pool demand as follows; other independent service workloads retain
their Phase 2A values:

| Preset | Pool requests/tick | Assigned per healthy backend | Backend utilization |
| --- | ---: | ---: | ---: |
| Normal | 120 | 60 | 66.67% |
| High | 180 | 90 | 100% |
| Spike | 270 | 135 | 150% |

Gateway capacity in the node definition is the nominal aggregate 180; its active
capacity comes from usable backends. Its utilization is an aggregate display metric,
and its overload counter stays zero. Only processing instances can trip locally
from this pool's traffic. Existing manual fail/repair commands still apply to the
logical gateway; a local gateway outage/restart prevents all pool admission.

### Accounting and pool health

`RoutingPoolState` records incoming, assigned, unassigned, processed, unserved, and
available-capacity totals; the sorted `routedMemberIds` used at tick start; and a
member ledger of assigned/processed/unserved requests. Member runtime traffic gives
assigned incoming demand and utilization; pool state gives actual throughput.

For each routed backend, processed requests are `min(assigned, capacity)` if it
remains usable after overload evaluation, otherwise zero. Excess assignments are
unserved. A backend that trips during the tick retains its arrival/capacity/
utilization measurements to explain the trip, as in Phase 2A, but processes **zero**
requests. There is no attempt to rescue its assignments in the same tick; they are
explicitly unserved. The next tick excludes that latched failed member and routes
to remaining destinations. `routedMemberIds` describes the assignment decision,
so it can still include an instance that subsequently tripped during that tick.

Every evaluated tick obeys:

- `assigned <= incoming`; if any destination exists, `assigned == incoming`.
- `processed <= assigned` and `processed <= usable capacity`.
- `incoming == processed + unserved`.
- `unserved == unassigned + sum(member unserved)`.
- Failed/unavailable members process zero; all request counts are finite,
  nonnegative integers. Utilization alone is a rounded percentage.

No usable capacity means pool offline. Usable capacity with any unserved requests
means pool degraded; otherwise it is healthy. One failed member alone is not a
gateway outage: with demand 60, the surviving 90-capacity member keeps it healthy.
At demand 120, the same survivor processes 90 and leaves 30 unserved, so the gateway
degrades. Logical manual/recovery/required-dependency precedence remains stronger
than pool aggregation. A pool shortage never sets the logical service's local
condition to failed.

Pool changes emit factual `traffic-redistributed` events only when the sorted
destination list changes. `pool-status-changed` records only health transitions,
with capacity, processed, and unserved measurements. Existing overload and ordinary
status events remain unchanged. Repeated stable ticks do not duplicate these events.

`SimulationMetrics` reports run-wide incoming/processed/unserved requests, counting
pool external demand once and adding independent non-pool service demand. Logical
gateway/member aliases are excluded from that volume sum. Unavailable independent
services' external demand is counted as unserved. It also counts offline services,
processing services with a positive overload streak in the evaluated tick
(including a newly tripped instance), and nonhealthy services reachable downstream
from the gateway. The downstream count is a topology/status measure, not proof that
every such fault was caused by this pool.

### Reproducible cascade and recovery

On Normal, fail Instance A as the first action. With the default threshold 3:

| Tick | Backend/pool result | Downstream result |
| --- | --- | --- |
| 1 | A manually failed; B assigned 120 at 133.33%, processes 90; gateway degraded | Still reads previous healthy gateway |
| 2 | B's overload streak reaches 2; 30 pool requests remain unserved | Direct gateway consumers degrade |
| 3 | B trips locally; throughput 0, unserved 120; gateway offline | Direct consumers still read previous degraded gateway |
| 4 | No routing destinations; all 120 requests unassigned/unserved | Direct gateway consumers go offline |
| 5 | Both instances remain locally failed until repaired | Support goes offline through CRM's next dependency hop |

This timing is derived from demand, capacity, and the configured threshold. Raising
the threshold or repairing an instance changes the sequence; no status schedule is
hardcoded. Repair clears either local failure cause and retains the two-tick delay.
A member can rejoin routing on the tick its restart completes. Its return can lower
the peer's assignment and clear a surviving overload streak. A locally failed peer
never resurrects without Repair. Reset clears pool allocation, processing, metrics,
counters, local causes, and events; the preset and UI selection remain selected.

### Validation, graph, and limits

Validate one logical service and exactly two existing distinct backend IDs. Reject
nonzero independent demand on any pool participant, unknown IDs, nonintegral or
negative pool demand, and unsafe aggregate integer totals. Cycle validation includes
virtual logical-gateway-to-member edges, so an instance cannot depend on its own
logical gateway directly or indirectly. Ordinary AND dependencies for those same
membership edges are rejected.

The graph adapter adds labeled pool-membership links separately from ordinary
required/optional edges. New backend nodes display their real runtime states. The
base topology is constant throughout actions and workload changes; no routing
update modifies coordinates, graph identity, or camera behavior.

This remains a fictional educational model, not Microsoft 365 infrastructure.
Phase 2B mode has one two-member pool, equal integer routing, and no intra-tick
retry or capacity-aware second allocation. Its default manual scenario keeps
retries disabled. Optional Phase 3A support below adds a pool retry queue without
changing that baseline; there is no realistic load balancer or generic orchestration.

## RESURRECTION — optional retries and recovery comparison (Phase 3A)

### Configuration and request identity

`SimulationScenario.retry?: RetryConfig` enables gateway-pool retries. It specifies
`policy` (naive/controlled), `maxPendingRequests`, `maxAgeTicks`,
`eligibilityPercent` (integer 0–100), and `retryBudgetPerTick` (requests, not a
capacity percentage). The existing FAILCHAIN/manual scenario leaves this unset;
its states and events retain Phase 2B behavior. Queue/budget zero are valid; request
age must be positive. Validation bounds potential cumulative counts within safe
integer arithmetic for the scenario's maximum tick count.

The configured pool demand is **new unique requests per tick**. A retry is another
attempt for a unique request that previously failed; it never increases the unique
arrival count. The pool's existing incoming/processed/unserved ledger describes
attempts when retries are enabled. `SimulationState.retry` separately records new
arrivals, retry attempts, successful new/retried completions, permanent abandonment,
pending cohorts, and their cumulative unique-request totals. Existing run-wide
traffic metrics remain physical attempt volume plus non-pool independent traffic.
Comparison request metrics are explicitly scoped to the gateway pool.

Pending requests are aggregate FIFO `{ bornTick, count }` cohorts, not individual
request objects. All newly failed eligible requests from one tick form one cohort.
Eligibility is applied once: `floor(newUnserved * eligibilityPercent / 100)` enter
the queue; the rest are permanently unserved. Failed retries remain eligible and
retain their original arrival tick. Successful retries are removed permanently.
There is at most one attempt per pending request in a tick; newly queued requests
cannot retry until a later tick.

Before release, a cohort expires when `tick - bornTick >= maxAgeTicks`. Expired
requests are abandoned permanently. After processing, merge cohorts by birth tick,
keep oldest requests up to `maxPendingRequests`, and abandon newest overflow.
Retry failure never refreshes request age. Queue size, cohort count, and request
lifetime are bounded; all abandonment is counted explicitly.

### The two release policies

Let `N` be new unique demand, `P` eligible pending requests after expiry, `C` the
eligible pre-overload gateway capacity, and `B` the retry budget in requests/tick.

- **Naive:** if C > 0, release P retries; otherwise release zero. New and retry
  attempts compete under the unchanged routing/capacity/overload rules.
- **Controlled:** release `min(P, B, max(0, C - N))`. Reserve capacity for new
  requests before admitting retries. Hold the rest pending with unchanged age.

Both policies use the same two backends, capacities, processing priority, repair
delay, and overload threshold. Retry admission never overrides local failures,
dependency gating, or the ordinary overload counter. A controlled retry budget
cannot prevent new demand alone from exceeding available capacity.

Distribute combined new-plus-retry attempts through the existing equal-share pool.
For accounting, calculate the new-request share on the same routed members using
the same integer remainder rule; retries occupy the residual combined assignment.
Each backend processes new requests first, then retries within its actual completed
processing. This preserves per-backend capacity and assignment limits, including
odd request counts and instances that trip before processing. Within completed
retry traffic, credit oldest issued cohorts first. No same-tick second allocation
or retry of a successful request occurs.

Per tick, `attempts = N + releasedRetries = processedAttempts + unservedAttempts`.
The unique-request invariants are separate:

```text
totalUniqueGenerated = totalCompletedUnique + totalAbandonedUnique + pendingUnique
previousPending + N = completedNew + completedRetries + abandonedThisTick + pendingAfter
```

Retry attempts appear in neither equation as new arrivals. Unserved attempts may
remain pending and are not automatically permanent request losses. Gateways with
zero eligible capacity issue zero retries and process zero requests. Peak utilization
is measured as combined attempt demand / pre-overload eligible capacity when
capacity is positive; zero-capacity ticks count as unavailable, not infinite load.

### Fair, reproducible experiment

`RECOVERY_EXPERIMENT` fixes the Normal FAILCHAIN scenario: 120 new gateway
requests/tick, A/B capacity 90 each, overload threshold 3, and two-tick restarts.
Its horizon is 40 ticks, queue limit 2,400, maximum request age 40 ticks, eligibility
100%, and controlled budget 30 retries/tick. A is failed at tick 2, repaired at 6;
B is repaired at 7. The first tick is healthy and balanced. Under either policy B
initially trips from redistribution at tick 4. A rejoins at 8 and B at 9.

`compareRecoveryStrategies` starts two fresh states and drives the pure engine with
the same tick-indexed schedule. Only the retry policy differs. It never changes
demand, capacities, queue rules, repair schedules, or overload rules to favor a
policy. Invalid commands and duplicate/out-of-horizon scheduled ticks are errors,
not silently skipped. There is no React, timer, or network dependency in the runner.

With one restored backend at tick 8, even controlled admission briefly overloads
on new demand alone (120 > 90). When B returns, controlled retries fit within spare
capacity and the overload clears. Naive release adds the entire accumulated backlog:
the resulting persistent overload trips A again at 10 and B at 11. These outcomes
are calculated, not scheduled. A separate test fixture with A/B capacity 90/40,
new demand 60, and budget 20 verifies that controlled admission can avoid *any*
renewed overload after repair while naive admission still causes secondary failure;
within that fixture, both runs again use identical inputs except policy.

### Metrics, stability, and events

All reported comparison request counts, peak utilization, and failure counts refer
to the gateway pool. An overload failure is a backend `overload-failed` event;
secondary failures are such events after that member has had a repair initiated.
Counts measure failure events, not distinct member IDs. Repair initiation remains
the existing `command-applied/repair` event. Retry-enabled runs additionally emit
`recovery-completed`, aggregate backlog-growth/release/abandonment events, and
`stable-recovery-achieved`. Existing overload events get `afterRepair` metadata to
explain renewed overload or secondary failure. There are no per-request events;
new event volume scales with ticks and service transitions, not queued requests.

Stable recovery requires the logical gateway and both locally ready backends to
be healthy and the backlog empty for **three consecutive ticks**. Confirmation is
recorded on the third tick, measured from experiment tick 0. If that condition later
breaks, the recovery marker is cleared; only the final uninterrupted stable period
qualifies at the horizon. Otherwise results say **Not recovered**. Stability refers
to service/backlog health, not a guarantee that no earlier requests were abandoned;
abandonment is always reported separately.

The default 40-tick comparison calculates:

| Gateway metric | Naive | Controlled |
| --- | ---: | ---: |
| Unique requests generated | 4,800 | 4,800 |
| Completed unique requests | 660 | 4,800 |
| Retry attempts | 2,250 | 570 |
| Abandoned/permanently unserved | 1,740 | 0 |
| Pending at horizon | 2,400 | 0 |
| Peak eligible-capacity utilization | 733.33% | 133.33% |
| Overload failures | 3 | 1 |
| Secondary failures after repair | 2 | 0 |
| Ticks with no usable gateway capacity | 34 | 4 |
| Stable recovery confirmation | Not recovered | Tick 29 |

The UI runs this fixed comparison explicitly on button click and stores only its
own results. It does not dispatch to or replace the active manual simulation,
selection, camera, or current manual workload. The side-by-side table uses runner
metrics; collapsed logs show each run's actual engine events. Repeating the action
recomputes the same results from fresh initial states.

This retained Phase 3A reference remains useful for regression tests. Optional
Phase 3B configuration extends it below. The default manual simulation still has
retries disabled, and neither comparison alters its state or graph.

## Advanced resilience — Phase 3B

### Scheduling and retry limits

`RetryConfig` now accepts `maxRetryAttempts`, optional `backoff` settings, and an
optional `circuitBreaker`. Retry policies are Naive, Controlled, and Adaptive.
Legacy inputs without scheduling/attempt-limit settings retain their original
cohort shape and behavior; request age still bounds their lifetime and possible
attempt count. The new comparison explicitly uses the same maximum **6 retries**
for all three policies, in addition to the same queue/age/eligibility constraints.

Tracked cohorts add `attempts`, `eligibleTick`, and a stable `bucket`. `attempts`
counts retry attempts already issued; the original new request is not a retry.
Before retry #1, attempts=0. After retry #1 fails, attempts=1, and so on. Scheduling
uses integer simulation ticks:

```text
nominalDelay = min(maxDelayTicks, baseDelayTicks * 2^attempts)
delay = min(maxDelayTicks, nominalDelay + boundedJitter)
eligibleTick = failureTick + delay
```

Base delay is at least one tick. A retry never executes before `eligibleTick`.
Without backoff, the legacy one-tick wait remains. Actual issuance increments the
attempt count; holding a request for a budget, future eligibility, or breaker
deferral does not. A failed request at the retry limit is immediately abandoned
and counted. A limit of zero permits no retries. Original arrival age, expiry, and
newest-overflow abandonment still apply, even if a due tick lies beyond expiry.
Only identical birth/bucket/attempt/due-time cohorts merge; different attempt
histories are never collapsed together.

### Deterministic jitter

The jitter function uses 32-bit FNV-1a (`Math.imul`, unsigned integer arithmetic),
initialized with a configurable unsigned 32-bit seed. Its identity combines the
scenario ID, pool ID, request birth tick, fixed bucket, and attempt number. There
is no evolving random stream: unrelated queue operations do not change another
cohort's jitter. Equal inputs reproduce the same offsets; different seeds may
produce permitted scheduling variation, without a guarantee of better results.

New failed requests use at most four aggregate jitter buckets. The hash produces
an inclusive integer offset `0..jitterTicks`, clipped to the maximum total delay.
Requests within a bucket share timing; this is cohort jitter, not per-client
randomness. A zero jitter window disables variation. No randomness package or
wall-clock input is used. Finite age, queue size, retry count, and cohort grouping
bound storage and repeated work.

### One gateway-client circuit breaker

Breaker state is stored separately as `SimulationState.circuitBreaker`, never in
service local condition. It protects client admission to the one gateway pool:

- **CLOSED:** allow new requests and policy-budgeted due retries. A qualifying
  failure is an observed tick with at least one admitted pool attempt unserved
  after actual processing/overload. It can arise from insufficient capacity,
  unavailable routing, or a backend trip. Count consecutive observed failure
  ticks; an all-successful observed tick resets the streak. An idle tick holds
  the streak. Budget waits, backoff waits, and breaker deferrals are not failures.
- **OPEN:** admit no new requests or retries. New arrivals can enter the retry
  queue under the same eligibility/age/queue/attempt-limit rules. Due retries stay
  pending without consuming an attempt or renewing age. Failed servers remain
  failed until repaired. A trip at tick T with cooldown C blocks C complete
  subsequent ticks; probes become eligible at `T + C + 1`.
- **HALF_OPEN:** admit at most the probe budget across new and retry requests,
  with new requests first and retry budgets still enforced. Any failed admitted
  probe reopens the breaker for a full cooldown. A nonempty all-successful probe
  batch closes it at tick end; ordinary admission resumes next tick. No probes
  means no success evidence, so it stays half-open.

The failure threshold measures qualifying **ticks**, not individual failed
requests. The default is 3 ticks, cooldown 3, and probe budget 10 requests/tick.
The initial B overload at tick 4 still occurs under this default; lower thresholds
can protect it earlier. An experiment whose fixed Repair command is no longer
valid must surface an error rather than silently skip commands or fake a failure.

Physical routing eligibility and capacity are calculated independently of the
breaker, even when admitted attempt demand is zero. OPEN does not imply backend
offline, and CLOSED does not prove full recovery. A logical gateway with less
usable capacity than its configured new-request demand stays degraded even when
the breaker restricts admission to small successful probes. No usable capacity
still means offline. Locally failed backends cannot become healthy without Repair;
operational degraded backends can naturally shed overload when traffic falls.

The pool ledger counts actual admitted backend attempts, so OPEN has zero such
attempts and zero processing. Deferred new requests still count as new unique
arrivals in the retry ledger and are queued or permanently abandoned explicitly.
Retry completion classification uses admitted new shares; blocked requests cannot
be credited as processed. The unique-request conservation equations remain intact.

### Adaptive comparison and metrics

Adaptive combines due-time scheduling with the Controlled spare-capacity retry
budget. Backoff/jitter and the breaker are explicit Adaptive-only options. The
comparison panel exposes base/max delay, jitter window/seed, a shared retry limit,
and a breaker toggle in a compact settings section. Changes clear stale results.
Topology, capacities, new workload, initial backlog, failure/repair commands,
recovery delays, horizon, queue bounds, and retry limit stay identical across the
three runs. Only these documented recovery policies differ. The 3D graph is unchanged.

The UI's `createResilienceExperiment` defaults are base delay 1, maximum delay 8,
jitter window 2, seed 1337, shared retry limit 6, and Adaptive breaker enabled with
the parameters above. All other inputs come from the same Phase 3A experiment.
The retained `RECOVERY_EXPERIMENT` preserves original Naive/Controlled regression
values; its default Adaptive run uses backoff/jitter without a breaker unless
explicitly configured. Disabling both Adaptive options makes its admission match
Controlled under the same limits.

Existing results remain in `run.metrics`; `run.resilience` adds peak retry attempts
per tick, breaker trips, fully OPEN admission ticks, breaker deferral decisions,
successful half-open probes, and retry abandonment (expiry + overflow + retry-limit
exhaustion; fresh ineligible requests are excluded from this last count). A pending
request can be deferred more than once; deferral decisions are neither new unique
arrivals nor actual backend retry attempts. Half-open success counts processed
probe requests, not inferred backend health.

Stable recovery additionally requires the configured breaker to be CLOSED. A
healthy backend behind an open client breaker is not reported as recovered. Peak
utilization uses admitted attempts against physical pre-overload eligible capacity;
zero-capacity intervals are unavailable ticks, not infinite percentages. Events
record aggregate backoff schedules, breaker transitions/probe outcomes, and existing
local recovery/secondary failures. No individual request logging is introduced.

The default new comparison calculates:

| Gateway metric | Naive | Controlled | Adaptive |
| --- | ---: | ---: | ---: |
| Unique requests generated | 4,800 | 4,800 | 4,800 |
| Completed unique requests | 660 | 4,800 | 4,800 |
| Total retry attempts | 2,250 | 570 | 650 |
| Peak retry attempts/tick | 570 | 30 | 30 |
| Abandoned unique requests | 1,740 | 0 | 0 |
| Remaining backlog | 2,400 | 0 | 0 |
| Peak utilization | 733.33% | 133.33% | 133.33% |
| Overload failures | 3 | 1 | 1 |
| Secondary failures | 2 | 0 | 0 |
| Physical unavailable ticks | 34 | 4 | 4 |
| Breaker trips | 0 | 0 | 1 |
| Fully open admission ticks | 0 | 0 | 3 |
| Breaker deferral decisions | 0 | 0 | 1,422 |
| Successful half-open probes | 0 | 0 | 10 |
| Retry abandonment | 1,740 | 0 | 0 |
| Stable recovery confirmation | Not recovered | Tick 29 | Tick 32 |

Adaptive's extra admission restriction costs latency here: it releases fewer new
requests at partial restoration, generating more pending work than Controlled.
It is not labeled universally better. Tests also cover long backoff causing expiry
and additional abandonment. Changing settings recomputes results; no failure count
or recovery time is scripted. Comparisons remain isolated from manual controls.

This is a fictional educational simulation. It models one breaker, cohort-level
jitter, tick-batched failure observation, equal-share routing, and strict new-request
priority. It does not model real client clocks, per-request latency, a production
load balancer, distributed breaker consensus, or adaptive optimization. There is
no generative AI recovery. The Phase 5A/5B sections below describe the later incident
presentation and visual polish; these do not change the Phase 3B model.

## AUTOPILOT — Phase 4

AUTOPILOT is a small **rule-based recovery controller**, not a generative AI agent.
It observes the current snapshot and returns a repair or wait decision with the
next tick, target (for repair), rule, and reason. All functions are deterministic
TypeScript without React, timers, random values, external services, or hidden state.
The simulation engine and its dependency/traffic/retry/breaker rules are unchanged.

### Rules and explicit history

- **Detect:** only the configured gateway pool's two members are repair targets.
  Local `failed` conditions qualify; an overload cause is distinguished from manual
  injection. A ready service offline through a dependency never needs its own repair.
  Locally restarting instances cannot receive another controller repair.
- **Wait safely:** default cooldown is **2 complete ticks after local failure**.
  Failure at F is first repairable at `F + cooldownTicks + 1`. A repair is also
  separated from the last intervention by that cooldown; the later deadline wins.
  The existing engine restart delay still applies. Repeated failures get a fresh
  failure-based cooldown; they do not reset intervention counts.
- **Select one:** among eligible members, choose stable ascending service ID. The
  decision identifies completely unavailable pool, degraded pool, or other local
  failure priority. All targets belong to one pool, so they share its priority;
  this is intentionally not a multi-pool scheduler. Skip blocked candidates so a
  cooling first ID does not starve another eligible instance.
- **Stop thrashing:** default limits are **2 repairs per instance and 4 total**.
  Exhaustion produces WAIT until Reset, rather than an endless restart loop.
  `AutopilotConfig` exposes cooldown and both finite budgets; the UI exposes cooldown.
  Zero budgets disable interventions; cooldown zero allows repair on the next tick.

`AutopilotState` lives alongside `SimulationState`, outside the engine. It stores
an observed event cursor, per-instance failure tick/cause/count, accepted repair
count/last tick, whether a repair occurred since the last failure, failed repair
cycle count, and a separate decision log. Observation consumes actual engine
`command-applied` and `overload-failed` events once. It includes manual gateway
repairs, even while disabled, so toggling cannot erase cooldown/budget history.
No controller decision is inserted into the engine's event stream. Reasons explain
failure detection, repeated failure, selection, cooldown, budget exhaustion, or WAIT;
they never claim a selected repair succeeded.

### Integration and manual priority

AUTOPILOT starts disabled. Enabling it does not advance time. An explicit **Step
simulation** observes the current snapshot, chooses at most one repair, and calls
the existing `step` with that ordinary command (or without a command for WAIT).
The returned engine snapshot determines all recovery outcomes. It can complete a
restart while a provider stays offline, or overload and fail again after restarting.
There is no future-state lookahead or predicted success.

Manual Fail/Repair retains existing permissions and owns its entire tick; the
controller records a manual-priority WAIT and submits no additional command. Manual
repairs are explicit overrides of controller cooldown/budget rules, but still count
against subsequent autonomous interventions. When disabled, manual engine behavior
is identical to earlier phases and no controller decisions execute. Selection,
camera, and graph objects remain independent. Invalid commands preserve both prior
snapshots. At maxTicks, no new command/decision executes. Reset/workload changes
clear controller history and disable it, while retaining configured cooldown.
Toggling alone retains all history. Logs are bounded by the existing run horizon.

### Fair repair-policy experiment

`AUTOPILOT_EXPERIMENT` and `compareAutopilot` are separate from the existing
Naive/Controlled/Adaptive comparison. Both repair policies use the same scenario:
Normal workload, 120 new pool requests/tick, two 90-capacity backends, Adaptive
retries (base 1/max 8/jitter 2/seed 1337/max 6 attempts), breaker 3/3/10, empty initial
queue, the same queue constraints, two-tick restarts, and a 40-tick horizon.
Both inject failure of A at tick 2. Injection takes the tick's only command slot.

The Fixed Runbook has slots to repair A at 6 and B at 7. Each slot uses the same
current-state eligibility check, cooldown 2, member permissions, and budgets 2/4 as
AUTOPILOT. A blocked or invalid repair slot records WAIT and is not rescheduled.
Malformed schedules or invalid failure injections throw visibly. AUTOPILOT instead
selects repairs from the current snapshot, without reading the future schedule.
Only repair selection differs; both runners use the same existing engine.
The UI comparison is isolated from manual state and manual controller settings.

Metrics use actual engine events/history and the existing retry ledger:

- Recovery actions count accepted gateway repair commands, not recommendations.
- Failed recovery attempts count repair cycles followed by another local failure
  before the horizon, at most once per accepted repair. This is an outcome counter,
  not causal attribution; an injected failure would also count. An unfinished or
  dependency-blocked restart is not labeled successful.
- Repeated instance failures count local failures after each instance's first one.
- Offline service-ticks sum services with effective status `offline` after every
  evaluated tick, across **all services**; `recovering` is a separate status and
  excluded. Request counts and stable recovery remain **gateway-pool** metrics.
- Stable recovery reuses the existing three consecutive healthy/empty-backlog/
  closed-breaker ticks, still valid at the horizon. Otherwise: **Not recovered**.

Calculated default results:

| Metric | Fixed Runbook | AUTOPILOT |
| --- | ---: | ---: |
| Recovery actions | 2 | 2 |
| Failed recovery attempts | 0 | 0 |
| Repeated instance failures | 0 | 0 |
| Offline service-ticks | 27 | 21 |
| Completed unique requests | 4,800 | 4,800 |
| Abandoned requests | 0 | 0 |
| Remaining backlog | 0 | 0 |
| Stable recovery confirmation | Tick 32 | Tick 32 |

AUTOPILOT selects A at 5 and B at 7; the fixed slots select A at 6 and B at 7.
Earlier repair reduces offline service-ticks here but does not improve final stable
recovery time. Results are calculated, not scripted. Tests also demonstrate renewed
overload exhausting all budgets and infrastructure remaining collapsed. A separate
fixture with unequal backend capacities and a one-tick overload threshold shows
the fixed runbook recovering sooner by restoring the larger backend first.

Limitations: ID priority is deliberately simple and capacity-unaware. The controller
cannot repair providers outside the gateway pool, change workload, tune retries,
or guarantee availability. Cooldowns are fixed, budgets do not replenish, and no
wall-clock latency, health checks, distributed coordination, or real infrastructure
is modeled. Phase 5A adds presentation playback below; the controller itself still
contains no timers. Phase 5B refines its presentation without changing these rules.

## INCIDENT ZERO — Phase 5A

### Playback lifecycle and compatibility

The UI owns `IncidentState` around the existing `AppState`. Simulation modules and
`reduceAppState` are unchanged. `reduceIncidentState` delegates every command/tick
to the existing application reducer, including the same AUTOPILOT integration.
Only a successful Fail action with an actual `command-applied/fail` event starts
a new incident. Invalid commands produce the existing error without a new incident
or injection notice. A new successful injection replaces the presentation session;
the complete engine log remains intact.

Automatic playback is enabled by default, with a visible **Play automatically after
Fail** checkbox for manual-only operation. Failure applies its engine tick first,
then the UI schedules one additional Step every **800 ms**. Wall-clock delay only
controls presentation; simulation duration remains measured in integer ticks using
the scenario's existing tick duration. Slow rendering never adds catch-up ticks.

`useIncidentPlayback` schedules one `setTimeout`, not an interval. Every callback
carries a sequence ID and expected current engine tick. The reducer rejects stale
sequences and duplicate ticks. Effect cleanup cancels the timeout on pause,
cancellation, replacement, reset, workload change, or unmount. A local cancellation
flag also guards callbacks; sequence/tick guards remain effective if a callback
was already queued. StrictMode's setup/cleanup/setup therefore cannot double-step.
The engine remains independent of timers, React, and wall-clock time.

- **Pause/Resume:** no engine command on pause; resume schedules the next single
  tick within the original incident's remaining observation window.
- **Skip to End:** synchronously performs the same engine Steps and event
  observation, subject to exactly the same stop rules and bounds. It never jumps
  directly to predicted statuses or silently repairs anything.
- **Reset/workload:** cancel immediately, invalidate callbacks, and clear incident
  presentation. Existing workload/reset semantics still apply, including disabling
  AUTOPILOT. The automatic/manual presentation preference is retained.
- **Manual Step/Fail/Repair/controller changes:** pause playback, then honor the
  user's action in the same reducer transaction. Invalid commands remain errors;
  they are never dropped or converted into different commands. Selection and graph
  navigation do not pause playback or advance time.
- **AUTOPILOT:** playback never toggles it. When already enabled, each playback
  Step invokes its existing controller/engine command path and separate decision
  history. Isolated RESURRECTION and repair-policy comparisons remain independent
  of the manual simulation and playback session.

### Stop conditions and truthful summaries

Playback ends at the engine `maxTicks`, after **18 additional ticks** since the
injection, or after **two consecutive quiet ticks** when safe. Status transitions,
overload starts/trips, restart completion, pool-health transitions, breaker
transitions, and stable-recovery confirmation are meaningful incident changes.
Steady counter increments alone are not cascade transitions.

Quiet is safe only when there is no local restart, overload streak, retry backlog,
open/half-open breaker, or locally failed gateway member with a remaining controller
budget and a current/future eligible repair. Every member is checked: one exhausted
instance must not hide another instance's pending cooldown. Long restart delays,
retry due-times, breaker cooldowns, and controller waits therefore run to activity
or the bounded cap, rather than being declared settled after two silent ticks.
The current scenarios have fixed workloads and no future scheduled UI injections;
a future scheduled-workload feature must extend this guard.

**Settled describes propagation, not resolution.** A steady latched outage can end
playback while still labeled ongoing. Ongoing means any nonhealthy service,
pending retry backlog, or nonclosed configured breaker. At the cap, show
**"Playback paused — incident may be ongoing"**; the automatic window cannot be
extended by Resume. Manual Steps, repairs, AUTOPILOT controls, and Reset remain
available. The nonblocking summary continues to reflect subsequent actual engine
states. It does not claim a restart succeeded or that a quiet outage recovered.

### Alerts and reproducible severity

Alerts consume only newly appended engine events, in event order:

1. **Initial failure:** confirmed fail command produces one brief fault banner,
   naming the actual offline service. It is not repeated as a duplicate card.
2. **Impact:** actual `status-changed` events to degraded/offline produce service
   notices. When engine `providerIds` are present, show dependency impact and those
   provider names. Pool/local capacity changes without provider causes are labeled
   service impact, not invented dependency failures. Unchanged statuses emit none.
3. **Critical cascade:** at least **6 currently degraded or offline services**
   crosses the defined critical threshold. Announce only on crossing from below
   it, rather than on every unchanged tick. Recovering is counted separately.
   This is a fictional simulator classification, not a real-world SEV-1 label.

An actual transition to healthy, or from offline/recovering to degraded, emits
**SERVICE IMPROVED** with the observed status. Starting a restart is not success.
All notices are historical tick-stamped observations; current counters always read
the current snapshot. Alert history retains at most **40** notices, with at most
**3** visual cards at once. The complete engine log is unaffected. A single polite,
atomic live region summarizes each observed tick instead of announcing every card.

### Impact versus exposure

Actual impact counts current offline and degraded services separately and together;
recovering is a separate count. Peak impact is the maximum concurrent offline plus
degraded count observed since injection, not a sum of all transitions. A separate
unique list includes the trigger and services observed transitioning to nonhealthy
states after injection. These counts cover all services, including any concurrent
workload effects; timing does **not** establish causation by the trigger.

Exposure is reverse reachability from the trigger along consumer/provider edges,
including optional edges. Virtual gateway-member-to-logical-gateway capacity paths
are included as potential exposure only: an available redundant member can prevent
actual impact. The trigger itself is excluded from the exposure list. Exposure is
never added to actual impact or described as a confirmed failure.

The summary shows required providers of observed affected services and their actual
statuses. When available, it also shows measured gateway availability, available
and unavailable capacity against configured capacity, and actual unserved pool
attempts for the last evaluated tick. This is the existing attempt ledger; breaker
deferrals are not backend attempts. Unavailable metrics are omitted. Elapsed duration
is current tick minus injection tick (zero on the injection tick). No financial,
user-count, security, real vendor, or real incident-telemetry claims are introduced.

### Restrained presentation and verification

CSS provides a graph-local 1.8-second injection banner, short fade/slide card
transitions, and amber/red incident borders. Overlays do not cover the whole screen;
only the Phase 5B notice-dismiss button accepts pointer input. The graph remains operable, with actual
status colors and selected-node size priority. A status-changing node receives
small volume emphasis during its observed playback tick, removed on subsequent
ticks/pause. Appearance accessors never replace topology objects, reheat layout,
or move the camera. There are no particles, sounds, or artificial propagation timers.
Reduced-motion CSS removes slide/border transitions; the brief banner hides without
continuous fading. The inventory, controls, summary, and timeline work without WebGL.

Vitest covers engine-confirmed starts, invalid commands, event alerts, threshold
crossings, exposure, pause/resume/skip, caps, reset/stale callbacks, fake-timeout
cleanup/StrictMode lifecycle, AUTOPILOT equivalence, factual summaries, bounded
history, and graph appearance/coordinate preservation. Existing tests are unchanged.
Browser automation was unavailable in this environment (browser access host
unavailable); interactive visual checks remain manual:

1. On Normal, fail Identity with automatic playback enabled. Confirm one immediate
   injection tick, later dependency warnings/critical threshold, and a settled but
   ongoing outage summary. Rotate/zoom the graph and confirm the camera stays put.
2. Pause, Resume, and Skip; verify no doubled or hidden ticks. Repair during playback
   and verify it pauses while accepting the repair. Step through the real restart.
3. Reset during playback, wait longer than 800 ms, and confirm tick 0 remains. Repeat
   with a workload change. Disable automatic mode and confirm Fail advances only once.
4. Enable AUTOPILOT, fail Gateway Instance A, and observe ordinary controller repairs
   and factual engine events. Run both isolated comparisons without replacing manual
   state. Check keyboard focus, narrow layouts, reduced motion, and WebGL fallback.

### Visual identity and UX polish — Phase 5B

This phase changes presentation only. Simulation/state contracts, dependency and
traffic rules, retry/breaker/controller decisions, experiment inputs/calculations,
and Phase 5A playback scheduling are unchanged. There are no new packages or APIs.

`theme.ts` owns a single palette, exposed as CSS custom properties on the document
and application shell and used directly by status badges and WebGL colors:

| Token | Value | Purpose |
| --- | --- | --- |
| `--bg` | `#090E17` | Page background |
| `--surface` | `#111B29` | Main panels |
| `--elevated` | `#172335` | Controls, table headers, raised surfaces |
| `--border` | `#29374A` | Panel and row boundaries |
| `--text` | `#F1F5FB` | Primary text/metrics |
| `--secondary` | `#A5B6CC` | Supporting labels |
| `--interaction` | `#70A7FF` | Selection, focus, primary actions |
| `--healthy` | `#52D7AE` | Actual healthy status |
| `--degraded` | `#F5B85C` | Actual degraded status |
| `--offline` | `#FF777F` | Actual offline status and confirmed fault notices |
| `--recovering` | `#9C91FF` | Actual recovery status |

Additional graph, muted-text, link, and stronger-border tokens remain in the same
palette. Healthy/interaction colors have distinct meanings: enabled controller or
selected control uses blue, not green. Text and semantic status colors are tested
at >=4.5:1 against the main dark surfaces; disabled controls remain visibly inactive.

Desktop keeps service explorer / large graph / inspector in one aligned row. Its
height is bounded between 650 and 820 px and adapts to available screen height.
The inspector and explorer scroll within their panels. At <=1080 px the inspector
stacks below the explorer/graph; at <=700 px panels stack, with a 440 px graph
viewport. No brittle fixed inspector grid-row placement remains. Wide event/results
tables scroll inside their panels rather than expanding page width. Main controls
wrap instead of disappearing, and Step/Reset are available in the header.

Graph nodes increase from relative size 6.5 to 8, with stronger links, larger arrows,
and escaped hover labels explaining consumer-to-provider direction and membership.
Existing selected-node volume priority and actual status colors are preserved.
Initial fit and explicit Fit Network use a tighter 3.5% edge-margin target. **Reset
camera** explicitly restores front orientation and fits; it never resets simulation
or graph coordinates. Initial fitting remains once-only, and status updates never
recreate topology, reheat layout, or move the camera.

Fault controls appear near the top of the inspector, above long metric/dependency
lists. Compact fact cards wrap long IDs/values and display selected-member controller
budget/cooldown history when supplied. AUTOPILOT presents Disabled, Monitoring,
Waiting, and Repair selected based only on its existing enabled flag and decision.
Enabled/next action, last action, and reason remain separate, with no implication
of an LLM or guaranteed recovery.

RESURRECTION marks rows whose displayed calculated values differ, with a neutral
**Different** label. It does not rank policies, choose a winner, or change metrics.
Sticky table headers, tabular numbers, and scroll containers keep comparisons usable.

Incident notices retain event ordering and the three-card/40-entry limits. A local
**Dismiss notices** action hides only current cards; future notices can appear and
the timeline/engine log remain intact. Dismissal resets for a new incident. The
historical transition determines notice color: green only for an actual transition
to healthy, amber for degraded, purple for recovering. Missing transition context
uses a neutral blue improvement accent rather than asserting healthy status.
The timeline is expanded by default and scrolls within a bounded height. Injection
and status notices are positioned inside the graph without resizing the canvas.

Keyboard focus covers buttons, fields, summaries, and scroll regions. State labels
always accompany colors. Reduced-motion rules remove movement/transitions; the
short injection notice still hides without continuous fading. The tick header
does not duplicate the incident summary's live announcements while an incident is
active. WebGL fallback keeps explorer, inspector, playback, and comparisons usable.

Verification: original tests are preserved; added checks cover shared palette and
contrast, camera-only operations, tooltip escaping, truthful improvement colors,
controller labels, inspector placement, and unchanged comparison data. Browser
access host remains unavailable, so no pixel-level checks at 1440/1280/768 px have
been performed. The manual checklist above still applies; additionally inspect
panel alignment/scrolling at those widths, dismiss/new-notice behavior, focus,
reduced motion, and Fit versus Reset Camera after rotating the network.

Known limits: 3D bundle size remains unchanged; actual WebGL framing, narrow-screen
card overlap, and interactive dismissal require the manual browser checks. Phase 6
is not included.

## Phase 1 baseline and acceptance

The implemented baseline has one 8–12-service fictional scenario with a dependency chain, fan-out,
required/optional links, and an independent branch. Provide a selectable 3D graph,
direction arrows, four labeled status colors, a plain service list/details view,
Fail, Repair, Step, Reset, tick display, and event log. The service list provides
keyboard-accessible selection/actions; graph navigation is not required to operate
the simulation. Keep playback manual.

Automated acceptance in Vitest, using small fixtures:

| Case | Expected result |
| --- | --- |
| Initialization/reset | Tick 0; all ready/healthy; log empty; repeated reset identical. |
| Chain and direction | `C -> B -> A` follows the tick 1/2/3 failure example; failing C leaves A/B healthy. |
| Branch isolation | Fan-out consumers fail on their next tick; unrelated nodes remain healthy. |
| Optional and mixed dependencies | Optional unavailable provider degrades its consumer; a required unavailable provider overrides degradation with offline. |
| Degradation propagation | A degraded required provider degrades its consumer one tick later. |
| Repair | Tick 4 repair follows the tick 4–8 example; repairing one provider cannot bypass another failed required provider. |
| Command boundaries | Invalid commands preserve state; failing a recovering service cancels its restart. |
| Determinism/immutability | Same inputs yield equal states/logs; reordered node/link arrays give equal results; frozen prior inputs remain unchanged. |
| Validation/limits | Bad IDs, links, cycles, or config are rejected; stepping at maxTicks preserves state. |

Manual acceptance: graph and details agree after each action; arrow direction and
status meaning are readable; graph movement does not advance simulation; keyboard
controls work; unsupported WebGL shows an explanation while the service list still
works. A local production build runs with external networking disabled and makes
no external requests. Type checking, build, and simulation tests must pass.

Phase 1 excludes strategy comparison, charts, automatic playback, scenario editing,
import/export, persistence, realistic traffic, retries, and circuit breakers.

## Risks and incremental extensions

- **Perceived realism:** one-tick propagation and worst-provider rules are teaching
  approximations. Avoid claims about outage predictions, real timings, or vendors.
- **Rendering and accessibility:** WebGL and force layout add GPU cost and visual
  clutter. Start small, use ordinary nodes/links, stop layout after settling, and
  preserve the usable service list when 3D is unavailable.
- **State coupling:** layout coordinates/link objects must stay in the graph layer;
  simulation tests must run without rendering or a GPU.
- **Cycles:** snapshot updates terminate, but cyclic outages can sustain themselves
  after local repairs. Reject cycles initially; define explicit bootstrap/recovery
  semantics before enabling them.
- **Load fidelity:** Phase 2A services keep fixed independent demand. Phase 2B adds
  one explicitly defined equal-share pool; queueing, capacity derating, and real
  load balancing remain unmodeled. No vendor behavior is inferred from these rules.
- **Retries/circuit breakers:** Phase 3B models bounded cohort retries and one client
  breaker for the gateway pool. Admission changes attempted load, not backend local
  health. Per-service breakers and individual-request timing remain unmodeled.
- **Recovery experiments:** runs share initial topology, workload, queue constraints,
  retry limits, and explicit tick-indexed failure/repair commands. Backoff and breaker
  policies can increase latency or abandonment; compare calculated outcomes rather
  than assuming protection always improves recovery.
- **Compatibility:** keep React/Vite/Vitest/graph versions compatible and preserve
  the lockfile. Phases 2A/2B add no packages or runtime services.

## Stack references

[Vite's static-build and localhost preview documentation](https://vite.dev/guide/static-deploy)
supports the local static-app delivery approach.
[The react-force-graph documentation](https://github.com/vasturiano/react-force-graph)
documents its standalone 3D React package, WebGL rendering, graph IDs, interaction,
and directional arrows; the simulation semantics above are FAULTLINE design choices.
[Vitest's guide](https://vitest.dev/guide/) documents Vite integration and standalone
test execution for the pure engine.

## Simplified command center and forecast warnings

The main interface now uses **Time**, **Step**, **Live incident**, **Affected now**,
**What fails next**, and **Incident timeline**. Time is simulated elapsed time;
Step remains the discrete unit of engine progress. Technical contracts retain
integer ticks internally. The main dashboard contains the explorer, named graph,
compact inspector, incident controls/summary, timeline, and recovery comparison.
The AUTOPILOT panel and inspector controller details are not mounted there. Its
internal controller, permissions, command path, and tests remain unchanged.
Existing detailed presentation components remain available internally, while the
normal comparison uses a compact view and collapsed measurement/settings details.
No engine algorithms, retry rules, overload thresholds, or experiment calculations
change in this refinement. There are no new packages.

### Named, stable 3D graph

`createDisplayGraph` owns its display coordinates. It assigns service tiers from
provider relationships, including pool membership for layout, then spaces siblings
by provider position. It fixes x/y/z coordinates for each node, with a small depth
variation. These coordinates never enter simulation state. The resulting 3D scene
is an intentional layered diagram rather than a continuously moving force layout.
Status/selection updates retain graph objects, layout, and camera. Initial fitting
runs once; Fit and Reset Camera remain explicit camera-only operations.

`GraphLabels` renders every service name and actual status as a sharp DOM label.
Positions come from the graph's supported `graph2ScreenCoords` API, updated on
camera changes, initial graph updates, viewport changes, and status/selection.
No Three.js/sprite-text dependency is added. A bounded placement pass prioritizes
the selected label and tries nearby positions to reduce overlap. Labels behind the
camera or outside its viewport are hidden. Extreme viewing angles can still crowd
labels; Fit or Reset Camera restores a clearer view. Clicking a name uses the same
service selection action as the inventory. Animation-frame callbacks and camera
listeners are cleaned up on unmount. Node colors always reflect actual state;
selection uses size/blue label framing without replacing the service status color.

### Forecasts are dry runs, not simulation commands

After a confirmed failure, `predictIncident` clones both scenario and application
state, including retry cohorts, breaker state, and controller history. It replays
at most **six** ordinary `reduceAppState(..., { type: "step" })` actions, capped by
`maxTicks`. It records the first worsening transition to degraded/offline for each
service. Already confirmed outages, improvements, and mere reachability are not
reported as predicted failures. This uses the same engine and optional controller
path as actual playback; there is no second simulation engine or new failure rule.
The live state, live event log, selection, and controller budgets remain untouched.

Forecasts refresh after actual engine progress, repairs, or controller configuration
changes. Reset/workload changes clear them. Skip observes real steps as before and
computes a fresh forecast at the resulting state. Errors yield an unavailable
forecast with no guessed impacts. There are no random or wall-clock inputs.

Approximate warning time is `futureSteps * playbackIntervalMs / 1000`, rounded to
one decimal place. Playback and predictions share the same **800 ms** interval
constant: one future step is approximately 0.8s of playback, two are 1.6s. This is
**presentation time**, not a promise of wall-clock latency or simulated service
response time. While paused/manual, warnings use steps rather than a running
seconds countdown. Changing traffic, repairing a service, pausing, or future user
commands can change the outlook. Forecasts assume current conditions continue and
do not foresee unscheduled user actions. The six-step horizon is not proof of
safety beyond it.

### One readable warning surface

The graph-integrated warning panel separates:

- **CONFIRMED NOW:** actual current service status, initially the injected failure.
  Recovery started means a real local restart; restored means actual healthy status.
- **AT RISK NEXT:** the cloned model predicts a worsening transition next step.
- **POSSIBLE CASCADE:** a later dry-run transition, or a reachable connection with
  explicitly unknown timing. Reachability alone never becomes a timed prediction.

At most four forecast cards show a mix of immediate/later impacts, with an actual
remaining-predictions count. Current downstream impacts replace forecasts as real
steps occur. Minimize/Show warnings changes local presentation only; graph input,
Step/Pause/Reset, and the inspector remain available. The panel scrolls within a
bounded graph-local area and automatically compacts after playback ends. Reduced
motion disables its entrance animation. No sound, fake telemetry, or external
monitoring is introduced.

`ProductTimeline` displays confirmed status changes, overload starts, and repair
commands in real order, with simulated time. It avoids duplicate degraded/restart
rows when another event already explains that transition. It shows up to 80 recent
entries, follows new entries unless scrolled back, and leaves the complete engine
history unchanged. Predictions never appear as confirmed timeline events.

The palette now uses near-black graphite, electric blue, amber risk, red outages,
and semantic healthy/recovery colors. The layout gives the graph more space and
removes long normal-dashboard explanations. Recovery results keep their calculated
values, with concise primary rows and expandable details. The full historical
technical components are retained for compatibility and existing tests.

Verification covers dry-run immutability, actual future transitions, interval
conversion, bounded horizons, unavailable forecasts, paused warnings, persistent
labels, fixed display coordinates, main-panel removal, readable timelines, and
unchanged legacy behavior. Browser access remains unavailable, so live WebGL,
label overlap, minimization, and responsive visual checks still require a browser.
No visual verification is claimed for this environment.

### Compact perimeter warnings

The large graph warning panel is replaced by one small box per currently affected
service, distributed around the top, right, bottom, and left edges of the graph.
The center is left clear, and only the Minimize/Show control accepts pointer input.
Confirmed boxes use actual status colors; distinct amber boxes retain bounded
forecast timing. Each service appears once. Boxes stay expanded after playback
settles so latched outages remain visible, until the user minimizes them. The
current twelve-service scenario fits unique perimeter slots; compact responsive
styles and reduced-motion behavior are retained. Simulation and prediction rules
are unchanged.

### Amber palette, dedicated card rails, and two-second pacing

The current color treatment follows the supplied reference's charcoal, amber,
orange, warm cream, and rust accents. Existing font families and typography are
retained. Semantic service colors remain distinguishable and text contrast is
covered by the existing palette tests.

Warning boxes now occupy dedicated space outside `.graph-safe-area`. That central
viewport clips the canvas, node labels, and graph controls. Desktop reserves side,
top, and bottom rails; narrower layouts move warnings into rows above/below the
graph. The frame is always reserved, so starting/minimizing an incident does not
resize the graph or reset the camera. Card slots remain stable per service within
an incident. Extra panel height preserves a usable central graph on small screens.

Automatic playback now advances one actual step every **2 seconds**. Forecasts use
that same constant: one predicted step is about 2 seconds of playback, two are
about 4 seconds. Timing tests were updated to the new requested interval without
changing model outcomes. Explicit manual Step and Skip still act immediately.

A separate UI reveal queue introduces new warning boxes at least **2 seconds apart**.
The trigger appears first; future risks are prioritized next so there is time to
act. Existing visible cards update immediately with real status changes. Pending
cards always read current state when shown, so an expired forecast is not displayed
as a future failure. Live graph status and counts are never delayed by the reveal
queue. Queued cards can continue appearing after playback settles; minimize, reset,
new incidents, and unmount cancel pending presentation timers. StrictMode setup and
cleanup cannot produce duplicate reveals. Reduced motion removes entrance movement
while preserving the reading gap.

Forecast wording distinguishes "May go down in ~4 seconds" from "May degrade";
paused playback uses step counts. "Please repair [service]" follows actual failed
providers or failed gateway pool members. Dependency-only outages are not offered
as repair targets; recovering/healthy services are not falsely suggested for repair.
This is an actionable suggestion, not a guarantee that one repair prevents all
predicted impact. When no failed repair target exists, cards suggest pausing and
reviewing load. At the engine limit they suggest Reset.

The fonts, simulation rules, retry/controller algorithms, and unique-request
accounting are unchanged. Browser automation remains unavailable here; geometry
is separated structurally and covered by boundary assertions, with manual visual
checks still recommended at the target viewport sizes.
