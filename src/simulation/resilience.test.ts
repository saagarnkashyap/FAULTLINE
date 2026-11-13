import { describe, expect, it } from "vitest";
import { createResilienceExperiment, DEFAULT_RESILIENCE_SETTINGS } from "../scenarios/resurrection";
import { failchainScenario } from "../scenarios/failchain";
import { finishCircuitBreaker, initialCircuitBreaker, prepareCircuitBreaker } from "./circuitBreaker";
import { failService, initializeSimulation, repairService, resetSimulation, step, validateScenario } from "./engine";
import { compareRecoveryStrategies } from "./experiments";
import { prepareRetries } from "./retries";
import { deterministicJitter, retryDelay } from "./retryScheduling";
import type { BackoffConfig, CircuitBreakerState, RetryConfig, SimulationScenario, SimulationState } from "./types";

function scenario(overrides: Partial<RetryConfig> = {}): SimulationScenario {
  const experiment = createResilienceExperiment();
  return { ...experiment.scenario, retry: { ...experiment.retry, policy: "adaptive", ...experiment.adaptive, ...overrides } };
}

function verify(topology: SimulationScenario, state: SimulationState, previous?: SimulationState) {
  const retry = state.retry!;
  expect(retry.totalUniqueRequests).toBe(retry.totalCompletedRequests + retry.totalAbandonedRequests + retry.pendingRequests);
  expect(retry.pendingRequests).toBe(retry.cohorts.reduce((sum, cohort) => sum + cohort.count, 0));
  expect(retry.pendingRequests).toBeLessThanOrEqual(topology.retry!.maxPendingRequests);
  expect(state.routingPool!.processedRequestsPerTick).toBe(retry.completedNewRequestsPerTick + retry.completedRetryRequestsPerTick);
  const admittedNew = state.routingPool!.incomingDemandPerTick - retry.retryAttemptsPerTick;
  expect(admittedNew).toBeGreaterThanOrEqual(0);
  expect(admittedNew).toBeLessThanOrEqual(retry.newRequestsPerTick);
  if (previous) expect(previous.retry!.pendingRequests + retry.newRequestsPerTick).toBe(
    retry.pendingRequests + retry.completedNewRequestsPerTick + retry.completedRetryRequestsPerTick + retry.abandonedRequestsPerTick,
  );
  for (const cohort of retry.cohorts) {
    expect(cohort.count).toBeGreaterThan(0);
    expect(cohort.attempts ?? 0).toBeLessThan(topology.retry!.maxRetryAttempts ?? topology.retry!.maxAgeTicks);
    expect(Number.isSafeInteger(cohort.eligibleTick ?? state.tick)).toBe(true);
    expect(state.tick - cohort.bornTick).toBeLessThan(topology.retry!.maxAgeTicks);
  }
  for (const id of topology.routingPool!.memberIds) {
    if (state.services[id]!.status === "offline" || state.services[id]!.status === "recovering") {
      expect(state.routingPool!.members[id]!.processedRequestsPerTick).toBe(0);
    }
  }
  function numbers(value: unknown): void {
    if (typeof value === "number") { expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0); }
    else if (value && typeof value === "object") Object.values(value).forEach(numbers);
  }
  numbers(state);
}

function replay(topology: SimulationScenario, duration = 40) {
  const schedule = createResilienceExperiment().schedule;
  let state = initializeSimulation(topology);
  const states = [state];
  for (let tick = 1; tick <= duration; tick += 1) {
    const previous = state;
    state = step(topology, previous, schedule.find((item) => item.tick === tick)?.command);
    verify(topology, state, previous);
    states.push(state);
  }
  return states;
}

describe("exponential scheduling and stable seeded jitter", () => {
  const backoff: BackoffConfig = { baseDelayTicks: 2, maxDelayTicks: 9, jitterTicks: 0, seed: 42 };

  it("numbers the first retry as attempt zero and caps exponential growth", () => {
    expect([0, 1, 2, 3, 4, 10000].map((attempt) => retryDelay(backoff, attempt, "cohort"))).toEqual([2, 4, 8, 9, 9, 9]);
  });

  it("hashes stable identifiers independently of unrelated calls, with permitted seed variation", () => {
    const values = (seed: number) => Array.from({ length: 20 }, (_, index) => deterministicJitter(seed, `pool|${index}|0|1`, 4));
    expect(values(1337)).toEqual(values(1337));
    expect(values(1)).not.toEqual(values(2));
    const before = deterministicJitter(1337, "pool|2|3|1", 4);
    deterministicJitter(1337, "unrelated-cohort", 4);
    expect(deterministicJitter(1337, "pool|2|3|1", 4)).toBe(before);
    for (const value of values(1)) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of values(2)) expect(value).toBeLessThanOrEqual(4);
  });

  it("never schedules before nominal backoff or beyond the configured maximum", () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      for (let seed = 0; seed < 10; seed += 1) {
        const delay = retryDelay({ ...backoff, jitterTicks: 3, seed }, attempt, "stable-cohort");
        expect(Number.isSafeInteger(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(Math.min(9, 2 * 2 ** attempt));
        expect(delay).toBeLessThanOrEqual(9);
      }
    }
  });

  it("holds future cohorts and issues them only at their eligible tick", () => {
    const topology = scenario({ circuitBreaker: undefined, backoff: { ...backoff, baseDelayTicks: 3, maxDelayTicks: 12 } });
    const first = failService(topology, initializeSimulation(topology), "gateway-a");
    expect(first.retry!.cohorts).toEqual([{ bornTick: 1, count: 30, attempts: 0, bucket: 0, eligibleTick: 4 }]);
    expect(prepareRetries(topology.retry!, first.retry!, 2, 180, 120).attempts).toBe(0);
    expect(prepareRetries(topology.retry!, first.retry!, 3, 180, 120).attempts).toBe(0);
    const due = prepareRetries(topology.retry!, first.retry!, 4, 180, 120);
    expect(due.attempts).toBe(30);
    expect(due.issued[0]!.attempts).toBe(1);
    expect(first.retry!.cohorts[0]!.attempts).toBe(0);
  });

  it("reschedules a failed retry using its new attempt number without renewing age", () => {
    const topology = scenario({ policy: "naive", circuitBreaker: undefined,
      backoff: { baseDelayTicks: 1, maxDelayTicks: 8, jitterTicks: 0, seed: 1 } });
    const first = failService(topology, initializeSimulation(topology), "gateway-a");
    const second = step(topology, first);
    expect(second.retry!.cohorts).toContainEqual({ bornTick: 1, count: 30, attempts: 1, bucket: 0, eligibleTick: 4 });
    expect(second.retry!.cohorts).toContainEqual({ bornTick: 2, count: 30, attempts: 0, bucket: 0, eligibleTick: 3 });
    const third = step(topology, second);
    expect(third.retry!.retryAttemptsPerTick).toBe(30); // Only birth tick 2 is due.
    verify(topology, third, second);
  });

  it.each([0, 1, 2])("abandons requests at the explicit retry limit %i", (maxRetryAttempts) => {
    const topology = scenario({ policy: "naive", circuitBreaker: undefined, backoff: undefined, maxRetryAttempts });
    let state = failService(topology, initializeSimulation(topology), "gateway-a");
    for (let tick = 2; tick <= 4; tick += 1) {
      const previous = state;
      state = step(topology, state);
      verify(topology, state, previous);
    }
    expect(state.events.some((event) => event.type === "retry-requests-abandoned" && (event.attemptLimit ?? 0) > 0)).toBe(true);
    expect(state.retry!.cohorts.every((cohort) => (cohort.attempts ?? 0) < maxRetryAttempts)).toBe(true);
    if (maxRetryAttempts === 0) expect(state.retry!.totalRetryAttempts).toBe(0);
  });

  it("replays the same seed exactly and allows bounded cohort scheduling variation for another seed", () => {
    const one = scenario({ circuitBreaker: undefined, backoff: { ...backoff, jitterTicks: 3, seed: 1 } });
    const two = scenario({ circuitBreaker: undefined, backoff: { ...backoff, jitterTicks: 3, seed: 2 } });
    expect(replay(one, 7)).toEqual(replay(one, 7));
    expect(replay(one, 7)[7]!.retry!.cohorts).not.toEqual(replay(two, 7)[7]!.retry!.cohorts);
    expect(replay(one, 7)[7]!.retry!.cohorts.length).toBeLessThanOrEqual(4 * 7);
  });
});

describe("single gateway circuit breaker", () => {
  function protectedScenario(cooldownTicks = 2, failureThreshold = 1) {
    return scenario({ backoff: undefined, circuitBreaker: { failureThreshold, cooldownTicks, halfOpenProbeBudget: 5 } });
  }

  it("trips only after the configured observed failure threshold", () => {
    const topology = protectedScenario(2, 2);
    const first = failService(topology, initializeSimulation(topology), "gateway-a");
    expect(first.circuitBreaker!.state).toBe("closed");
    expect(first.circuitBreaker!.consecutiveFailureTicks).toBe(1);
    const second = step(topology, first);
    expect(second.circuitBreaker!.state).toBe("open");
    expect(second.circuitBreaker!.trips).toBe(1);
  });

  it("defers requests for complete cooldown ticks, then closes after successful bounded probes", () => {
    const topology = protectedScenario();
    const first = failService(topology, initializeSimulation(topology), "gateway-a");
    expect(first.circuitBreaker!.nextProbeTick).toBe(4);
    const second = step(topology, first);
    const third = step(topology, second);
    expect(second.routingPool!.incomingDemandPerTick).toBe(0);
    expect(second.retry!.retryAttemptsPerTick).toBe(0);
    expect(third.circuitBreaker!.openTicks).toBe(2);
    expect(third.circuitBreaker!.state).toBe("open");
    expect(third.circuitBreaker!.trips).toBe(1); // Deferrals are not server failures.
    const fourth = step(topology, third);
    expect(fourth.events).toContainEqual({ type: "breaker-half-opened", tick: 4, serviceId: "gateway", probeBudget: 5 });
    expect(fourth.routingPool!.incomingDemandPerTick).toBe(5);
    expect(fourth.circuitBreaker!.successfulProbes).toBe(5);
    expect(fourth.circuitBreaker!.state).toBe("closed");
    expect(fourth.services["gateway-a"]!.local).toEqual({ kind: "failed" });
    expect(fourth.services.gateway!.status).toBe("degraded"); // Five probes don't prove 120/tick capacity.
    for (const [current, previous] of [[second, first], [third, second], [fourth, third]] as const) verify(topology, current, previous);
  });

  it("reopens after failed half-open probes without processing on unavailable instances", () => {
    const topology = protectedScenario();
    let state = failService(topology, initializeSimulation(topology), "gateway-a");
    state = failService(topology, state, "gateway-b");
    state = step(topology, state);
    state = step(topology, state);
    expect(state.circuitBreaker!.state).toBe("open");
    expect(state.circuitBreaker!.trips).toBe(2);
    expect(state.circuitBreaker!.nextProbeTick).toBe(7);
    expect(state.circuitBreaker!.successfulProbes).toBe(0);
    expect(state.events).toContainEqual({ type: "breaker-probe-result", tick: 4, serviceId: "gateway", processed: 0, failed: 5 });
    verify(topology, state);
  });

  it("keeps breaker state separate from actual backend health and does not claim stability while open", () => {
    const topology = protectedScenario(6);
    const config = { ...topology, retry: { ...topology.retry!, maxPendingRequests: 0 } };
    let state = failService(config, initializeSimulation(config), "gateway-a");
    state = repairService(config, state, "gateway-a"); // Ready at 4, breaker probes at 8.
    for (let i = 0; i < 4; i += 1) state = step(config, state);
    expect(state.circuitBreaker!.state).toBe("open");
    expect(state.services["gateway-a"]!.status).toBe("healthy");
    expect(state.services["gateway-b"]!.status).toBe("healthy");
    expect(state.services.gateway!.status).toBe("healthy");
    expect(state.routingPool!.processedRequestsPerTick).toBe(0);
    expect(state.retry!.pendingRequests).toBe(0);
    expect(state.retry!.stableRecoveryTick).toBeNull();
    expect(state.circuitBreaker!.deferredAttempts).toBeGreaterThan(0);
    verify(config, state);
  });

  it("does not close an idle half-open breaker without actual successful probes", () => {
    const config = { failureThreshold: 1, cooldownTicks: 2, halfOpenProbeBudget: 5 };
    const old: CircuitBreakerState = { ...initialCircuitBreaker(), state: "open", nextProbeTick: 4, trips: 1 };
    const admission = prepareCircuitBreaker(config, old, 4, 0);
    const pool = initializeSimulation(failchainScenario).routingPool!;
    const result = finishCircuitBreaker(config, admission, pool, 0, 4, "gateway");
    expect(result.state.state).toBe("half_open");
    expect(result.state.successfulProbes).toBe(0);
    expect(result.events.some(({ type }) => type === "breaker-closed")).toBe(false);
  });

  it("subjects open-breaker deferrals to queue, age, and retry-attempt limits", () => {
    const topology = { ...protectedScenario(12), retry: { ...protectedScenario(12).retry!, maxPendingRequests: 20, maxAgeTicks: 2 } };
    let state = failService(topology, initializeSimulation(topology), "gateway-a");
    for (let i = 0; i < 8; i += 1) {
      const previous = state;
      state = step(topology, state);
      verify(topology, state, previous);
    }
    expect(state.retry!.pendingRequests).toBeLessThanOrEqual(20);
    expect(state.retry!.totalAbandonedRequests).toBeGreaterThan(0);
    expect(state.retry!.totalRetryAttempts).toBe(0);
    expect(state.circuitBreaker!.trips).toBe(1);
  });
});

describe("fair Adaptive experiments, costs, and regression safety", () => {
  it("reduces actual peak retry traffic without changing failure/repair inputs or unique arrivals", () => {
    const experiment = createResilienceExperiment();
    const result = compareRecoveryStrategies(experiment);
    const runs = [result.naive, result.controlled, result.adaptive];
    const commands = (run: typeof result.naive) => run.finalState.events.filter(({ type }) => type === "command-applied");
    for (const run of runs) {
      expect(run.initialState.services).toEqual(result.naive.initialState.services);
      expect(run.initialState.retry!.pendingRequests).toBe(0);
      expect(run.metrics.totalUniqueRequests).toBe(4800);
      expect(commands(run)).toEqual(commands(result.naive));
    }
    expect(result.naive.resilience.peakRetryTrafficPerTick).toBe(570);
    expect(result.adaptive.resilience.peakRetryTrafficPerTick).toBe(30);
    expect(result.adaptive.metrics.secondaryFailures).toBe(0);
    expect(result.adaptive.resilience.breakerTrips).toBe(1);
    expect(result.adaptive.resilience.breakerOpenTicks).toBe(3);
    expect(result.adaptive.resilience.successfulHalfOpenProbes).toBe(10);
    expect(result.adaptive.metrics.stableRecoveryTick).toBe(32);
    expect(result.adaptive.metrics.stableRecoveryTick!).toBeGreaterThan(result.controlled.metrics.stableRecoveryTick!);
    expect(compareRecoveryStrategies(experiment)).toEqual(result);
  });

  it("can increase abandonment and latency with excessive backoff instead of inventing a better result", () => {
    const base = createResilienceExperiment();
    const experiment = { ...base, retry: { ...base.retry, maxAgeTicks: 5 },
      adaptive: { backoff: { baseDelayTicks: 25, maxDelayTicks: 25, jitterTicks: 0, seed: 1 } } };
    const result = compareRecoveryStrategies(experiment);
    expect(result.adaptive.metrics.abandonedRequests).toBeGreaterThan(result.controlled.metrics.abandonedRequests);
    expect(result.adaptive.metrics.completedUniqueRequests).toBeLessThan(result.controlled.metrics.completedUniqueRequests);
  });

  it("can abandon more unique requests when a long breaker cooldown outlasts queue age", () => {
    const base = createResilienceExperiment();
    const experiment = { ...base, retry: { ...base.retry, maxAgeTicks: 5 },
      adaptive: { ...base.adaptive, circuitBreaker: { failureThreshold: 3, cooldownTicks: 20, halfOpenProbeBudget: 10 } } };
    const result = compareRecoveryStrategies(experiment);
    expect(result.adaptive.resilience.breakerOpenTicks).toBe(20);
    expect(result.adaptive.metrics.abandonedRequests).toBeGreaterThan(result.controlled.metrics.abandonedRequests);
    expect(result.adaptive.metrics.completedUniqueRequests).toBeLessThan(result.controlled.metrics.completedUniqueRequests);
  });

  it("uses Controlled admission unchanged when Adaptive backoff and breaker options are off", () => {
    const result = compareRecoveryStrategies(createResilienceExperiment({ ...DEFAULT_RESILIENCE_SETTINGS, backoffEnabled: false, breakerEnabled: false }));
    expect(result.adaptive.metrics).toEqual(result.controlled.metrics);
    expect(result.adaptive.resilience).toEqual(result.controlled.resilience);
  });

  it("conserves all request classes and obeys eligibility across the full seeded experiment", () => {
    const states = replay(scenario());
    expect(states[40]!.retry!.totalCompletedRequests).toBe(4800);
    for (const state of states) {
      for (const event of state.events.filter((event) => event.tick === state.tick)) {
        if (event.type === "retry-backoff-scheduled") {
          expect(event.earliestTick).toBeGreaterThan(state.tick);
          expect(event.latestTick).toBeLessThanOrEqual(state.tick + 8);
        }
      }
    }
  });

  it("resets scheduling/breaker state and preserves frozen inputs and horizon limits", () => {
    function freezeDeep<T>(value: T): T {
      if (value && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
      return value;
    }
    const topology = freezeDeep(structuredClone(scenario()));
    let state = freezeDeep(initializeSimulation(topology));
    const initial = structuredClone(state);
    for (let tick = 1; tick <= 10; tick += 1) {
      const previous = state;
      const copy = structuredClone(state);
      state = freezeDeep(step(topology, previous, createResilienceExperiment().schedule.find((item) => item.tick === tick)?.command));
      expect(previous).toEqual(copy);
    }
    expect(resetSimulation(topology)).toEqual(initial);
    const bounded = { ...scenario(), config: { ...scenario().config, maxTicks: 2 } };
    const final = step(bounded, failService(bounded, initializeSimulation(bounded), "gateway-a"));
    expect(step(bounded, final)).toBe(final);
  });

  it("rejects invalid scheduling, seed, limit, and breaker parameters without weakening checks", () => {
    const base = scenario();
    for (const backoff of [
      { baseDelayTicks: 0, maxDelayTicks: 8, jitterTicks: 2, seed: 1 },
      { baseDelayTicks: 4, maxDelayTicks: 2, jitterTicks: 0, seed: 1 },
      { baseDelayTicks: 1, maxDelayTicks: 8, jitterTicks: 9, seed: 1 },
      { baseDelayTicks: 1, maxDelayTicks: 8, jitterTicks: 2, seed: -1 },
      { baseDelayTicks: 1, maxDelayTicks: 8, jitterTicks: 2, seed: 0x100000000 },
    ]) expect(() => validateScenario({ ...base, retry: { ...base.retry!, backoff } })).toThrow(/backoff|seed/i);
    expect(() => validateScenario({ ...base, retry: { ...base.retry!, maxRetryAttempts: -1 } })).toThrow(/maxRetryAttempts/);
    for (const key of ["failureThreshold", "cooldownTicks", "halfOpenProbeBudget"] as const) {
      expect(() => validateScenario({ ...base, retry: { ...base.retry!, circuitBreaker: { ...base.retry!.circuitBreaker!, [key]: 0 } } })).toThrow(/Circuit breaker/);
    }
  });
});
