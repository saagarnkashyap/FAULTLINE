import type { BreakerPhase, CircuitBreakerConfig, CircuitBreakerState, RoutingPoolState, SimulationEvent } from "./types";

export function initialCircuitBreaker(): CircuitBreakerState {
  return { state: "closed", consecutiveFailureTicks: 0, nextProbeTick: null,
    trips: 0, openTicks: 0, deferredAttempts: 0, successfulProbes: 0 };
}

export interface BreakerAdmission {
  readonly previous: CircuitBreakerState;
  readonly phase: BreakerPhase;
  readonly newRequests: number;
  readonly retrySlots: number;
  readonly halfOpened: boolean;
}

/** A trip blocks cooldownTicks complete subsequent ticks; probes start afterward. */
export function prepareCircuitBreaker(config: CircuitBreakerConfig, previous: CircuitBreakerState, tick: number, newDemand: number): BreakerAdmission {
  const halfOpened = previous.state === "open" && tick >= previous.nextProbeTick!;
  const phase = halfOpened ? "half_open" : previous.state;
  const newRequests = phase === "open" ? 0 : phase === "half_open" ? Math.min(newDemand, config.halfOpenProbeBudget) : newDemand;
  const retrySlots = phase === "open" ? 0 : phase === "half_open" ? config.halfOpenProbeBudget - newRequests : Infinity;
  return { previous, phase, newRequests, retrySlots, halfOpened };
}

export function finishCircuitBreaker(
  config: CircuitBreakerConfig,
  admission: BreakerAdmission,
  pool: RoutingPoolState,
  deferredAttempts: number,
  tick: number,
  serviceId: string,
): { state: CircuitBreakerState; events: SimulationEvent[] } {
  const events: SimulationEvent[] = [];
  const base = { tick, serviceId };
  const old = admission.previous;
  let state: CircuitBreakerState = { ...old, state: admission.phase,
    openTicks: old.openTicks + (admission.phase === "open" ? 1 : 0),
    deferredAttempts: old.deferredAttempts + deferredAttempts };
  function open(reason: "threshold" | "failed-probe") {
    const nextProbeTick = tick + config.cooldownTicks + 1;
    state = { ...state, state: "open", nextProbeTick, consecutiveFailureTicks: 0, trips: old.trips + 1 };
    events.push({ ...base, type: "breaker-opened", reason, nextProbeTick });
  }
  if (admission.phase === "closed" && pool.incomingDemandPerTick > 0) {
    const failures = pool.unservedRequestsPerTick > 0 ? old.consecutiveFailureTicks + 1 : 0;
    state = { ...state, consecutiveFailureTicks: failures };
    if (failures >= config.failureThreshold) open("threshold");
  } else if (admission.phase === "half_open" && pool.incomingDemandPerTick > 0) {
    state = { ...state, successfulProbes: old.successfulProbes + pool.processedRequestsPerTick };
    events.push({ ...base, type: "breaker-probe-result", processed: pool.processedRequestsPerTick, failed: pool.unservedRequestsPerTick });
    if (pool.unservedRequestsPerTick > 0) open("failed-probe");
    else {
      state = { ...state, state: "closed", nextProbeTick: null, consecutiveFailureTicks: 0 };
      events.push({ ...base, type: "breaker-closed" });
    }
  }
  return { state, events };
}
